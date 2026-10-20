import { fileURLToPath } from "node:url";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { readJsonProcess } from "../process/read-json-process.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

export interface DaemonRequest {
	readonly method: "GET" | "POST";
	readonly path: string;
	readonly body?: unknown;
	readonly deadline: number;
	readonly signal?: AbortSignal;
	/** Optional identity-acquire payload: sent before the actual request from the same helper process. */
	readonly identity?: Record<string, unknown>;
}
export interface DaemonReply { readonly status: number; readonly body: unknown }
export type DaemonRequester = (request: DaemonRequest) => Promise<DaemonReply>;

export function createDaemonRequester(dataDir: string): DaemonRequester {
	const helper = fileURLToPath(new URL("./daemon-request.mjs", import.meta.url));
	return async (request) => {
		const value = await readJsonProcess({
			command: process.execPath,
			args: [helper],
			env: { ...process.env, FSM_DATA_DIR: dataDir },
			deadline: request.deadline,
			...(request.signal ? { signal: request.signal } : {}),
			input: { dataDir, method: request.method, path: request.path, body: request.body, deadline: request.deadline,
				...(request.identity ? { identity: request.identity } : {}) },
		});
		if (!isAdmissionObject(value) || typeof value.status !== "number" || !Number.isInteger(value.status)
			|| value.status < 100 || value.status > 599 || !("body" in value)) throw new RuntimeError("protocol-invalid");
		return Object.freeze({ status: value.status, body: value.body });
	};
}

export async function requestMutation(request: DaemonRequester, input: DaemonRequest): Promise<DaemonReply> {
	if (input.signal?.aborted) throw new RuntimeError("cancelled");
	if (Date.now() >= input.deadline) throw new RuntimeError("deadline-exceeded");
	try {
		return await request(input);
	} catch {
		throw new RuntimeError("delivery-unknown");
	}
}

export function requireDaemonOk(reply: DaemonReply): void {
	if (reply.status < 200 || reply.status >= 300) throw new RuntimeError("transport-failed");
	if (!isAdmissionObject(reply.body) || reply.body.ok !== true) throw new RuntimeError("protocol-invalid");
}
