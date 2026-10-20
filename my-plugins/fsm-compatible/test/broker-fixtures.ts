import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonReply, DaemonRequester, DaemonRequest } from "../src/broker/daemon-request.ts";
import { isAdmissionObject } from "../src/admission/parse-policy-input.ts";
import { discoverFsmTools } from "../src/broker/fsm-catalog.ts";
import { McpTransport } from "../src/broker/mcp-transport.ts";

export async function protocolDirectory(t: { after(callback: () => Promise<void> | void): void }): Promise<string> {
	const base = fileURLToPath(new URL("./.tmp/", import.meta.url));
	await mkdir(base, { recursive: true });
	const directory = await mkdtemp(join(base, "d-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

export async function fakeTransport(t: { after(callback: () => Promise<void> | void): void }, mode = "normal") {
	const fixture = fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url));
	const transport = new McpTransport(process.execPath, [fixture, mode], { ...process.env });
	t.after(async () => { await transport.close(Date.now() + 10000); });
	const options = { deadline: Date.now() + 10000 };
	await transport.initialize(options);
	const catalog = await discoverFsmTools(transport, options);
	return { transport, catalog };
}

export function fakeDaemon() {
	const sources = new Map<string, Record<string, unknown>>();
	const seen: DaemonRequest[] = [];
	const request: DaemonRequester = async (input): Promise<DaemonReply> => {
		seen.push(input);
		if (input.path === "/session/register" && isAdmissionObject(input.body) && typeof input.body.session_id === "string") {
			sources.set(input.body.session_id, { session_id: input.body.session_id, agent_pid: process.pid, kind: "opencode",
				cwd: input.body.cwd, opencode_server_url: input.body.opencode_server_url, transcript_path: null });
			return { status: 200, body: null };
		}
		if (input.path.startsWith("/session/source?")) {
			const id = new URL(input.path, "http://local").searchParams.get("session");
			return id && sources.has(id) ? { status: 200, body: sources.get(id) } : { status: 404, body: {} };
		}
		return { status: 200, body: { ok: true } };
	};
	return { request, seen };
}
