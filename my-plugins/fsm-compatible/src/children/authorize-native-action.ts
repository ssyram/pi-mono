import type { PersistedBinding } from "../binding/actor-binding.ts";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { normalizeToolCall } from "../gates/tool-normalizer.ts";

export async function authorizeNativeAction(request: DaemonRequester, caller: PersistedBinding,
	action: string, input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<void> {
	const name = action === "launch" ? "Agent" : ["list", "send", "stop", "status"].includes(action) ? `agent_${action}` : undefined;
	if (!name || !isAdmissionObject(input) || !isAdmissionObject(input.params)) throw new Error("invalid native operation");
	const normalized = normalizeToolCall({ toolName: name, input: input.params });
	const reply = await request({ method: "POST", path: "/check-permission", deadline: Date.now() + timeoutMs, ...(signal ? { signal } : {}),
		body: { session_id: caller.rootSessionId, agent_id: caller.agentId,
			tool_name: normalized.toolName, tool_input: normalized.toolInput } });
	if (reply.status < 200 || reply.status >= 300 || !isAdmissionObject(reply.body) || reply.body.allowed !== true) {
		throw new Error(isAdmissionObject(reply.body) && typeof reply.body.reason === "string" ? reply.body.reason : "native FSM authorization failed");
	}
}
