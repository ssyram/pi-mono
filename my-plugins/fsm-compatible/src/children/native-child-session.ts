import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { NativeChildRecord } from "./native-child-record.ts";
import { enqueueInboxMessage } from "./child-inbox.ts";
import { patchChildMetadata } from "./child-metadata.ts";
import { tmuxHasSession, tmuxKillSession, tmuxSpawnChild } from "./tmux-session.ts";
import type { RecordStore } from "../records/record-store.ts";

export class NativeChildSession {
	readonly row: NativeChildRecord;
	private readonly options: { cli: string; coordinatorUrl(): string; bridgePassword: string; env: NodeJS.ProcessEnv;
		report(row: NativeChildRecord): void; closing(): boolean; onEvent?(row: NativeChildRecord, event: Record<string, unknown>): void };
	constructor(row: NativeChildRecord, options: NativeChildSession["options"]) { this.row = row; this.options = options; }

	async start(timeoutMs: number, signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		const row = this.row;
		row.lifecycle = "starting"; row.startupError = false;
		const bootstrap = join(row.directory, "bootstrap.json");
		await writeFile(bootstrap, JSON.stringify({ binding: row.binding, coordinatorUrl: this.options.coordinatorUrl(),
			token: row.token, depth: row.depth, bridgePassword: this.options.bridgePassword, extensionPath: row.bundle }), { mode: 0o600 });
		signal?.throwIfAborted();
		const env = { ...this.options.env };
		for (const key of Object.keys(env)) if (key.startsWith("PI_") && key !== "PI_CODING_AGENT_DIR") delete env[key];
		env.FSM_CHILD_BOOTSTRAP = bootstrap; env.FSM_COMPATIBLE_CONFIG = row.configFile;
		delete env.FSM_PARENT_SESSION_ID; delete env.FSM_AGENT_ID;
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		row.ready = { resolve, reject };
		const timer = setTimeout(() => reject(new Error("child extension readiness deadline")), timeoutMs);
		const deathWatch = setInterval(() => { void tmuxHasSession(row.tmuxSession).then((alive) => { if (!alive) reject(new Error("child tmux session died before readiness")); }); }, 500);
		deathWatch.unref();
		const cancel = () => { reject(new Error("child startup cancelled")); };
		signal?.addEventListener("abort", cancel, { once: true });
		await tmuxSpawnChild({ sessionName: row.tmuxSession, cwd: row.cwd, command: process.execPath,
			args: [this.options.cli, "-ne", "-a", ...row.extraArgs, "-e", row.bundle, "--model", row.model, "--thinking", row.thinking, "--session", row.sessionFile],
			env, logFile: join(row.directory, "process.log") });
		try {
			await ready;
			if (row.startupError) throw new Error("required child extension failed");
			row.lifecycle = "idle";
			await patchChildMetadata(row.directory, { state: "idle" });
		} catch (error) { await tmuxKillSession(row.tmuxSession); throw error; }
		finally { clearTimeout(timer); clearInterval(deathWatch); signal?.removeEventListener("abort", cancel); row.ready = undefined; }
	}

	async prompt(message: string): Promise<"queued"> {
		const row = this.row;
		if (!await tmuxHasSession(row.tmuxSession)) throw new Error("child tmux session unavailable");
		// runActive/lifecycle are event-driven: the child reports agent_start/settled.
		// Setting them here would lie for input handlers that swallow the message.
		await enqueueInboxMessage(row.directory, message);
		return "queued";
	}

	async stop(): Promise<void> {
		await tmuxKillSession(this.row.tmuxSession);
		this.row.runActive = false;
		this.row.lifecycle = "unavailable";
		if (this.row.outcome === null) this.row.outcome = "aborted";
		await patchChildMetadata(this.row.directory, { state: "stopped", outcome: "aborted" });
	}

	/** Clean parent shutdown: kill the TUI, keep transcript + metadata for resume. */
	async suspend(): Promise<void> {
		await tmuxKillSession(this.row.tmuxSession);
		this.row.runActive = false;
		await patchChildMetadata(this.row.directory, { state: "suspended" });
	}

	alive(): Promise<boolean> { return tmuxHasSession(this.row.tmuxSession); }

	publish(store: RecordStore): void {
		const manager = SessionManager.open(this.row.sessionFile);
		store.publishExecution(this.row.binding, { title: this.row.binding.agentName,
			lifecycle: this.row.lifecycle, updatedAt: Date.now(), header: manager.getHeader(),
			branch: manager.getBranch(), sessionFile: this.row.sessionFile,
			errorMessage: this.row.outcome === "failed" || this.row.outcome === "crashed" ? this.row.summary : null });
	}

	private event(event: Record<string, unknown>): void {
		const row = this.row;
		if (event.type === "extension_error" && row.ready) {
			row.startupError = true; row.ready.reject(new Error("required child extension failed"));
		}
		if (event.type === "agent_start") { row.runActive = true; row.lifecycle = "running"; }
		if (event.type === "message_end" && event.message && typeof event.message === "object") {
			const message = event.message as { role?: string; content?: { type?: string; text?: string }[]; stopReason?: string; errorMessage?: string };
			if (message.role === "assistant") {
				row.outcome = message.stopReason === "error" ? "failed" : null;
				row.summary = message.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n") ?? "";
				if (message.stopReason === "error") { row.outcome = "failed"; row.summary = message.errorMessage ?? "child provider failed"; }
			}
		}
		if (event.type === "agent_settled" && row.runActive) {
			row.runActive = false;
			row.outcome = event.aborted === true ? "aborted" : row.outcome ?? "completed";
			row.lifecycle = row.outcome === "failed" ? "failed" : "idle";
			if (!this.options.closing()) this.options.report(row);
		}
		this.options.onEvent?.(row, event);
	}
}
