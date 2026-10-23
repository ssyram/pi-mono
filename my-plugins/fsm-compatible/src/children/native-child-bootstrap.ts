import { readFile, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChildBinding } from "../binding/actor-binding.ts";
import type { RequiredExtensionInput } from "../admission/admission-policy.ts";

export interface NativeChildBootstrap {
	readonly binding: ChildBinding;
	readonly coordinatorUrl: string;
	readonly token: string;
	readonly depth: number;
	readonly bridgePassword: string;
	readonly extensionPath: string;
}

export async function readNativeChildBootstrap(): Promise<NativeChildBootstrap | undefined> {
	const path = process.env.FSM_CHILD_BOOTSTRAP;
	if (!path) {
		if (process.env.FSM_PARENT_SESSION_ID || process.env.FSM_AGENT_ID) throw new Error("child bootstrap missing");
		return undefined;
	}
	const value = JSON.parse(await readFile(path, "utf8")) as NativeChildBootstrap;
	if (!value || typeof value.token !== "string" || value.token.length < 32
		|| !Number.isSafeInteger(value.depth) || value.depth < 1 || typeof value.bridgePassword !== "string" || !value.bridgePassword || !value.binding
		|| typeof value.extensionPath !== "string" || !value.extensionPath
		|| value.binding.kind !== "execution-child" || value.binding.agentId !== value.binding.sessionId
		|| value.binding.sessionId === value.binding.rootSessionId) throw new Error("invalid child bootstrap");
	const url = new URL(value.coordinatorUrl);
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/") throw new Error("invalid child coordinator");
	return value;
}

export async function writeChildExtensionBundle(path: string, extensions: readonly RequiredExtensionInput[]): Promise<void> {
	const paths: string[] = [];
	for (const extension of extensions) {
		const canonical = await realpath(resolve(extension.path));
		if (!paths.includes(canonical)) paths.push(canonical);
	}
	const self = extensions.find((item) => item.id === "fsm-compatible");
	if (!self) throw new Error("mandatory FSM extension missing");
	const selfPath = await realpath(resolve(self.path));
	paths.splice(paths.indexOf(selfPath), 1); paths.push(selfPath);
	const imports = paths.map((name, index) => `import extension${index} from ${JSON.stringify(name)};`).join("\n");
	const calls = paths.map((_, index) => `await extension${index}(pi);`).join("\n");
	await writeFile(path, `${imports}\nexport default async function(pi) {\n${calls}\n}\n`, { mode: 0o600 });
}

export async function callNativeCoordinator(bootstrap: NativeChildBootstrap, action: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
	const response = await fetch(`${bootstrap.coordinatorUrl}/fsm-compatible/native-child`, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: bootstrap.token, action, input }), signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]),
	});
	const result = await response.json() as { error?: unknown; value?: unknown };
	if (!response.ok || typeof result.error === "string") throw new Error(typeof result.error === "string" ? result.error : "native coordinator unavailable");
	return result.value;
}
