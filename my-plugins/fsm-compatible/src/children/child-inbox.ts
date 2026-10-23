import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NativeChildBootstrap } from "./native-child-bootstrap.ts";
import { callNativeCoordinator } from "./native-child-bootstrap.ts";
import { patchChildMetadata, readChildMetadata, writeChildMetadata, type ChildMetadata } from "./child-metadata.ts";

const POLL_MS = 250;

interface InboxMessage {
	message: string;
	delivery?: "steer" | "followUp";
}

function isInboxMessage(value: unknown): value is InboxMessage {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<InboxMessage>;
	return typeof candidate.message === "string" && candidate.message.length > 0
		&& (candidate.delivery === undefined || candidate.delivery === "steer" || candidate.delivery === "followUp");
}

export function inboxDir(childDir: string): string {
	return join(childDir, "inbox");
}

/** Parent-side write; sequence-named so ordering survives concurrent writers. */
export async function enqueueInboxMessage(childDir: string, message: string, delivery: "steer" | "followUp" = "steer"): Promise<void> {
	const queue = inboxDir(childDir);
	await mkdir(queue, { recursive: true, mode: 0o700 });
	const seq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const final = join(queue, `${seq}.json`);
	const temp = `${final}.tmp`;
	await writeFile(temp, `${JSON.stringify({ message, delivery } satisfies InboxMessage)}\n`, { mode: 0o600 });
	await rename(temp, final);
}

/**
 * Child-side inbox consumer: polls this child's inbox directory and delivers
 * messages through the official message API. Idle → a fresh run; busy → native
 * steering (deliverAs). Also keeps metadata.json state in step with lifecycle
 * events and reports them to the parent coordinator over HTTP.
 */
export function registerChildRuntime(pi: ExtensionAPI, bootstrap: NativeChildBootstrap, initialContext?: ExtensionContext): () => void {
	const childDir = join(bootstrap.binding.rootSessionId.length > 0 ? "" : "", bootstrapDir(bootstrap));
	let context: ExtensionContext | undefined = initialContext;
	let timer: NodeJS.Timeout | undefined;
	let processing = false;
	let stopped = false;

	const reportEvent = (type: string, extra: Record<string, unknown> = {}): void => {
		void callNativeCoordinator(bootstrap, "event", { type, ...extra }).catch(() => { /* parent unreachable: file truth below */ });
	};

	const deliver = async (): Promise<void> => {
		if (processing || !context) return;
		processing = true;
		try {
			const queue = (await readdir(inboxDir(childDir)).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).sort();
			for (const name of queue) {
				if (stopped) return;
				const path = join(inboxDir(childDir), name);
				let payload: InboxMessage | undefined;
				try { const parsed: unknown = JSON.parse(await readFile(path, "utf8")); if (isInboxMessage(parsed)) payload = parsed; }
				catch { payload = undefined; }
				if (!payload) {
					await unlink(path).catch(() => {});
					await patchChildMetadata(childDir, { state: "error", error: `invalid inbox message ${name}` });
					continue;
				}
				const idle = context.isIdle();
				if (idle) pi.sendUserMessage(payload.message);
				else pi.sendUserMessage(payload.message, { deliverAs: payload.delivery ?? "steer" });
				await unlink(path);
			}
		} finally {
			processing = false;
		}
	};

	const offs = [
		pi.on("session_start", (_event, ctx) => {
			context = ctx;
			void (async () => {
				const current = await readChildMetadata(childDir);
				if (!current) return;
				await patchChildMetadata(childDir, { state: ctx.isIdle() ? "idle" : "busy",
					sessionId: ctx.sessionManager.getSessionId() });
				reportEvent("child_ready", { sessionId: ctx.sessionManager.getSessionId() });
			})();
		}),
		pi.on("agent_start", () => {
			void patchChildMetadata(childDir, { state: "busy", hasStarted: true, outcome: null, summary: "" });
			reportEvent("agent_start");
		}),
		pi.on("agent_settled", (_event, ctx) => {
			context = ctx;
			if (!ctx.isIdle()) return;
			void patchChildMetadata(childDir, { state: "idle" });
			reportEvent("agent_settled");
		}),
		pi.on("session_shutdown", (event) => {
			stopped = true;
			if (timer) { clearInterval(timer); timer = undefined; }
			if (event.reason === "quit") {
				void patchChildMetadata(childDir, { state: "exited" });
				reportEvent("child_exited");
			}
		}),
	];
	if (!timer) { timer = setInterval(() => { void deliver(); }, POLL_MS); timer.unref(); }
	void deliver();

	return () => {
		stopped = true;
		if (timer) { clearInterval(timer); timer = undefined; }
		for (const off of offs.splice(0)) off();
	};
}

function bootstrapDir(bootstrap: NativeChildBootstrap): string {
	return dirname(bootstrap.extensionPath);
}

export async function ensureChildMetadata(childDir: string, seed: Omit<ChildMetadata, "version" | "createdAt" | "updatedAt">): Promise<ChildMetadata> {
	const existing = await readChildMetadata(childDir);
	if (existing) return existing;
	const created: ChildMetadata = { ...seed, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	await writeChildMetadata(childDir, created);
	return created;
}
