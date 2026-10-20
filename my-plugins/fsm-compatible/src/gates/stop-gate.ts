import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import type { GateBinding } from "./permission-gate.ts";

export interface StopDecision {
	readonly allowed: boolean;
	readonly reason?: string;
}

function lastAssistantText(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as { role?: string; content?: unknown };
		if (message?.role !== "assistant") continue;
		if (!Array.isArray(message.content)) return undefined;
		const text = message.content.filter((block): block is { type: "text"; text: string } =>
			isAdmissionObject(block) && block.type === "text" && typeof block.text === "string")
			.map((block) => block.text).join("\n");
		return text.length > 0 ? text : undefined;
	}
	return undefined;
}

export async function runStopCheck(request: DaemonRequester, binding: GateBinding, contextMessages: readonly AgentMessage[], deadline: number): Promise<StopDecision> {
	const text = lastAssistantText(contextMessages);
	const reply = await request({ method: "POST", path: "/stop-check", deadline, body: {
		session_id: binding.sessionId, agent_id: binding.agentId,
		...(text !== undefined ? { last_assistant_message: text } : {}),
	} });
	// /stop-check answers {is_terminal} — no `ok` envelope either.
	if (reply.status < 200 || reply.status >= 300) throw new Error("stop-check transport failed");
	const payload = reply.body;
	if (!isAdmissionObject(payload) || typeof payload.is_terminal !== "boolean") throw new Error("stop-check protocol-invalid");
	return { allowed: payload.is_terminal,
		...(typeof payload.reason === "string" ? { reason: payload.reason } : {}) };
}

export interface StopGateDeps {
	/** True when any child agent of this session is still running (OC has_busy_child parity). */
	hasBusyChild(sessionId: string): boolean;
}

/** soft-gate Stop: transport failure passes with a diagnostic; real blocks append a continuation entry.
 *  Busy children override a non-terminal block: the parent may yield to wait for workers. */
export function installStopGate(pi: ExtensionAPI, request: DaemonRequester, binding: () => GateBinding | undefined,
	timeoutMs: number, deps?: StopGateDeps): () => void {
	const off = pi.on("agent_before_settle", async (event, ctx) => {
		const current = binding();
		if (!current) return undefined;
		if (event.outcome !== "completed" || event.continue) return undefined;
		try {
			const decision = await runStopCheck(request, current, event.context.contextMessages, Date.now() + timeoutMs);
			if (decision.allowed) return undefined;
			// ocsup-6 parity: a parent with running children may stop to wait for them.
			if (deps?.hasBusyChild(current.sessionId)) return undefined;
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content: decision.reason ?? "FSM Stop: continue required", display: true }], continue: true };
		} catch {
			ctx.ui.notify("FSM Stop gate unavailable; soft-gate pass-through", "warning");
			return undefined;
		}
	});
	return off;
}
