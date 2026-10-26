import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import { appendFileSync } from "node:fs";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import type { JudgeSessions } from "../judge/judge-session.ts";
import type { GateBinding } from "./permission-gate.ts";
import { collectStopEvidence, planStopRoute, reduceStop, resetStopGate, runStopAnalysis, type StopRouteFacts } from "./stop-analysis.ts";

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

interface StopCheckReply {
	isTerminal: boolean;
	stateMissing: boolean;
	isExitState: boolean;
	fsmName: string | null;
	stateId: string | null;
	noProgress: number;
	recentPlans: string[];
}

export async function runStopCheck(request: DaemonRequester, binding: GateBinding, contextMessages: readonly AgentMessage[], deadline: number): Promise<StopCheckReply> {
	const text = lastAssistantText(contextMessages);
	const reply = await request({ method: "POST", path: "/stop-check", deadline, body: {
		session_id: binding.sessionId, agent_id: binding.agentId,
		...(text !== undefined ? { last_assistant_message: text } : {}),
	} });
	if (reply.status < 200 || reply.status >= 300) throw new Error("stop-check transport failed");
	const payload = reply.body;
	if (!isAdmissionObject(payload) || typeof payload.is_terminal !== "boolean") throw new Error("stop-check protocol-invalid");
	const state = isAdmissionObject(payload.state) ? payload.state : undefined;
	return {
		isTerminal: payload.is_terminal,
		stateMissing: !state,
		isExitState: Boolean(state?.is_exit_state),
		fsmName: typeof state?.fsm_name === "string" ? state.fsm_name : null,
		stateId: typeof state?.state_id === "string" ? state.state_id : null,
		noProgress: typeof payload.no_progress_count === "number" ? payload.no_progress_count : 0,
		recentPlans: Array.isArray(payload.recent_plans) ? payload.recent_plans.filter((plan): plan is string => typeof plan === "string") : [],
	};
}

export interface StopGateDeps {
	/** True when any child agent of this session is still running (OC has_busy_child parity). */
	hasBusyChild?(sessionId: string): boolean | Promise<boolean>;
	/** Bridge password for the daemon's OpenCode source-auth refresh (HC env parity). */
	sourcePassword?: string;
	/** Marks a session whose turn continues after a Stop block (host default profile takes over). */
	markStopContinuation?(sessionId: string): void;
	/** Judge sessions for the soft-stop Analyze route; absent disables analysis with a warning. */
	judges?: JudgeSessions;
	/** FSM_STOP_ANALYSIS parity: default on; opt-out. */
	analysisEnabled?: boolean;
	/** Analysis judge budget per attempt. */
	analysisBudgetMs?: number;
}

// Dual-harness evidence: record the final Stop decision with the same shape
// the reference hook emits, so observation layers can verify it verbatim.
function dualStopLog(entry: Record<string, unknown>): void {
	const target = process.env.FSM_DUAL_STOP_LOG;
	if (!target) return;
	try {
		appendFileSync(target, JSON.stringify(entry) + "\n");
	} catch {
		/* best-effort evidence */
	}
}

/** Stop gate v2: hard law first, then the soft Analyze route (upstream hook parity, fail-closed). */
export function installStopGate(pi: ExtensionAPI, request: DaemonRequester, binding: () => GateBinding | undefined,
	timeoutMs: number, deps?: StopGateDeps): () => void {
	const off = pi.on("agent_before_settle", async (event, ctx) => {
		const current = binding();
		if (!current) return undefined;
		if (event.outcome !== "completed" || event.continue) return undefined;
		let check: StopCheckReply;
		try { check = await runStopCheck(request, current, event.context.contextMessages, Date.now() + timeoutMs); }
		catch (error) {
			// Hook parity: only connection-level failures soft-pass; protocol errors block.
			const message = error instanceof Error ? error.message : String(error);
			const isTransport = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connect|timeout|transport failed/i.test(message);
			if (isTransport) {
				ctx.ui.notify("FSM Stop gate unreachable; soft-gate pass-through", "warning");
				return undefined;
			}
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content: `FSM Stop：stop-check 协议错误，已保守阻止停止（${message}）。`, display: true }], continue: true };
		}
		if (check.isTerminal) return undefined;
		const analysisEnabled = deps?.analysisEnabled ?? true;
		const evidence = analysisEnabled
			? await collectStopEvidence(request, current, Date.now() + timeoutMs, deps?.sourcePassword).catch(() => ({ dir: null, liveWork: "unknown" as const }))
			: { dir: null, liveWork: "unknown" as const };
		const facts: StopRouteFacts = {
			isTerminal: check.isTerminal, stateMissing: check.stateMissing, isExitState: check.isExitState,
			fsmName: check.fsmName, stateId: check.stateId, noProgress: check.noProgress, recentPlans: check.recentPlans,
			lastAssistantMessage: lastAssistantText(event.context.contextMessages) ?? null,
			liveWork: typeof evidence.liveWork === "object"
				? evidence.liveWork
				: deps?.hasBusyChild && await Promise.resolve(deps.hasBusyChild(current.sessionId)).catch(() => false) === true
					? { confirmed: { subjects: [] } }
					: evidence.liveWork,
			analysisEnabled,
		};
		const plan = planStopRoute(facts);
		if (plan.kind === "allow") return undefined;
		if (plan.kind === "block-malformed") {
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content: "FSM Stop：状态数据缺失，已保守阻止停止。", display: true }], continue: true };
		}
		if (plan.kind === "deterministic") {
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content: plan.reason, display: true }], continue: true };
		}
		// HC plan_stop_route never short-circuits on live work: the judge sees
		// the live-work evidence and decides (wait_for_async_work).
		if (!deps?.judges) {
			ctx.ui.notify("FSM Stop analysis unavailable (no judge model); deterministic fallback", "warning");
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content: "FSM Stop：软门评审不可用，按确定性规则阻止停止。", display: true }], continue: true };
		}
		const sid = deps.judges.create();
		try {
			const verdict = await runStopAnalysis(deps.judges, sid, facts, evidence.dir);
			const decision = reduceStop(facts, verdict);
			dualStopLog({ session_id: current.sessionId, agent_id: current.agentId,
				last_assistant_message: facts.lastAssistantMessage, decision: decision.allowed ? "allow" : "block",
				action: "action" in verdict ? verdict.action : undefined,
				reason: "reason" in verdict ? verdict.reason : decision.reason,
				...(facts.noProgress > 0 ? { no_progress_count: facts.noProgress } : {}),
				agent: current.agentId === "main" ? "stop" : "subagent-stop" });
			if (decision.allowed) {
				if (decision.resetOnAllow) await resetStopGate(request, current, Date.now() + timeoutMs);
				ctx.ui.notify(decision.reason, "info");
				return undefined;
			}
			// HC hook identity: sessionId is the root sid, agentId the acting
			// child sid — the acting session is the one whose turn continues.
			deps?.markStopContinuation?.(current.agentId ?? current.sessionId);
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content: decision.reason, display: true }], continue: true };
		} finally { void sid; }
	});
	return off;
}
