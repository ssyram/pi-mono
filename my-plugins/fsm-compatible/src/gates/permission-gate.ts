import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { isFsmProjectedTool, normalizeToolCall } from "./tool-normalizer.ts";
import { gateShouldSuppress, moveGate } from "./gate-moves.ts";

export interface GateBinding {
	readonly sessionId: string;
	readonly agentId: string;
}

function checkBody(binding: GateBinding, toolName: string, toolInput: Record<string, unknown>) {
	return { session_id: binding.sessionId, agent_id: binding.agentId, tool_name: toolName, tool_input: toolInput };
}

async function callCheckPermission(request: DaemonRequester, body: Record<string, unknown>, deadline: number, signal?: AbortSignal): Promise<{ allowed: boolean; reason?: string }> {
	// Hook routes resolve the explicit actor IDs; only MCP calls consume identity slots.
	const reply = await request({ method: "POST", path: "/check-permission", deadline,
		...(signal ? { signal } : {}), body });
	// /check-permission answers {allowed, reason?} directly — it has no `ok` envelope.
	if (reply.status < 200 || reply.status >= 300) throw new RuntimeError("transport-failed");
	const payload = reply.body;
	if (!isAdmissionObject(payload) || typeof payload.allowed !== "boolean"
		|| (payload.reason !== undefined && typeof payload.reason !== "string")) throw new RuntimeError("protocol-invalid");
	return { allowed: payload.allowed, ...(payload.reason !== undefined ? { reason: payload.reason } : {}) };
}

/** fail-close permission gate: any transport/parse failure blocks the call. */
export function installPermissionGate(pi: ExtensionAPI, request: DaemonRequester, binding: () => GateBinding | undefined, timeoutMs: number): () => void {
	const off = pi.on("tool_call", async (event: { toolName: string; input: unknown }, ctx) => {
		const current = binding();
		if (!current) return { block: true, reason: "fsm-compatible runtime not ready" };
		// FSM-projected tools skip both the check and the gate move (broker is the sole entry).
		if (isFsmProjectedTool(event.toolName)) return undefined;
		if (typeof event.toolName !== "string") return { block: true, reason: "unknown tool" };
		try {
			// Step P3: normalize -> real server decision -> block or allow; never a local verdict.
			const normalized = normalizeToolCall({ toolName: event.toolName, input: event.input });
			const verdict = await callCheckPermission(request, checkBody(current, normalized.toolName, normalized.toolInput), Date.now() + timeoutMs, ctx.signal);
			// Step P2/fsm-5: main-gate bisection rides every verdict; best-effort, never a second verdict source.
			const suppress = gateShouldSuppress(verdict.allowed, normalized.toolName);
			void moveGate(request, current, suppress, suppress ? "ask-start" : "main-tool-start", Date.now() + timeoutMs);
			if (verdict.allowed) return undefined;
			return { block: true, reason: verdict.reason ?? `FSM 门禁：工具 ${normalized.toolName} 不允许使用。` };
		} catch {
			return { block: true, reason: "FSM 门禁：check-permission 不可达，按 fail-close 拒绝。" };
		}
	});
	return off;
}
