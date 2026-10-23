import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { requestMutation, type DaemonRequester } from "./daemon-request.ts";

export interface SourceOwner {
	readonly rootSessionId: string;
	readonly pid: number;
	readonly cwd: string;
	readonly serverUrl: string;
}

export async function registerAndConfirmSource(
	request: DaemonRequester,
	owner: SourceOwner,
	deadline: number,
	signal?: AbortSignal,
): Promise<void> {
	const attempted = await requestMutation(request, {
		method: "POST", path: "/session/register", deadline, ...(signal ? { signal } : {}),
		body: { session_id: owner.rootSessionId, cwd: owner.cwd, transcript_path: null, opencode_server_url: owner.serverUrl },
	});
	if (attempted.status < 200 || attempted.status >= 300) throw new RuntimeError("transport-failed");
	if (attempted.body !== null) throw new RuntimeError("protocol-invalid");
	const reply = await request({ method: "GET", path: `/session/source?session=${encodeURIComponent(owner.rootSessionId)}`,
		deadline, ...(signal ? { signal } : {}) });
	if (reply.status !== 200) throw new RuntimeError("not-ready", "FSM source read-back unavailable");
	const source = reply.body;
	if (!isAdmissionObject(source)) throw new RuntimeError("not-ready", "FSM source read-back malformed");
	const expected = { session_id: owner.rootSessionId, agent_pid: owner.pid, kind: "opencode", cwd: owner.cwd,
		opencode_server_url: owner.serverUrl, transcript_path: null };
	const mismatched = Object.entries(expected).filter(([key, value]) => source[key] !== value).map(([key]) => key);
	if (mismatched.length) throw new RuntimeError("not-ready", `FSM source read-back mismatch: ${mismatched.join(",")}`);
}
