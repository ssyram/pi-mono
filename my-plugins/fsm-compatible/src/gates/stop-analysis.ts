import { Ajv2020 } from "ajv/dist/2020.js";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import type { JudgeSessions } from "../judge/judge-session.ts";
import type { OcMessage, OcPart } from "../records/oc-shapes.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";

export interface StopRouteFacts {
	readonly isTerminal: boolean;
	readonly stateMissing: boolean;
	readonly isExitState: boolean;
	readonly fsmName: string | null;
	readonly stateId: string | null;
	readonly noProgress: number;
	readonly recentPlans: string[];
	readonly lastAssistantMessage: string | null;
	readonly liveWork: boolean;
	readonly analysisEnabled: boolean;
}

export type StopVerdictAction = "WaitForAsyncWork" | "HumanIntervention" | "ArrangeObservation";
export type StopAnalysisVerdict = { action: StopVerdictAction; reason: string };

export type StopRoutePlan =
	| { kind: "allow"; reason: string }
	| { kind: "block-malformed" }
	| { kind: "deterministic"; reason: string }
	| { kind: "analyze" };

/** Upstream hook plan_stop_route semantics: mechanical allow, malformed block, deterministic fallback, analyze. */
export function planStopRoute(facts: StopRouteFacts): StopRoutePlan {
	if (facts.isTerminal) return { kind: "allow", reason: "legal pause: no active FSM or state allows user interaction" };
	if (facts.stateMissing) return { kind: "block-malformed" };
	if (!facts.analysisEnabled) return { kind: "deterministic", reason: deterministicBlockReason(facts) };
	return { kind: "analyze" };
}

export function deterministicBlockReason(facts: StopRouteFacts): string {
	if (facts.isExitState) return "FSM Stop：当前处于退出态；若工作流已完成：对 `_fsm_exit` 做一次 fsm_submit_self_check，再 fsm_try_transition 到 `_fsm_exit` 退出。";
	return `FSM Stop：${facts.fsmName ?? "?"}/${facts.stateId ?? "?"} 不允许停止（无 allow_user_interaction）。`;
}

/** Upstream reduce_stop semantics: everything except the two justified allows fails closed. */
export function reduceStop(facts: StopRouteFacts, verdict: StopAnalysisVerdict | { error: string }): { allowed: boolean; reason: string; resetOnAllow: boolean } {
	if ("error" in verdict) return { allowed: false, reason: `FSM Stop 分析未能形成合法判定，已保守阻止停止：${verdict.error}`, resetOnAllow: false };
	const reason = verdict.reason.trim();
	if (reason.length === 0) return { allowed: false, reason: "FSM Stop 分析返回了空理由，已保守阻止停止。", resetOnAllow: false };
	if (verdict.action === "WaitForAsyncWork") return { allowed: true, reason, resetOnAllow: true };
	if (verdict.action === "HumanIntervention") {
		if (facts.recentPlans.length > 0) return { allowed: true, reason: `${reason}（no-progress ${facts.noProgress} 次，等待人工介入）`, resetOnAllow: true };
		return { allowed: false, reason: "FSM Stop 分析请求人工介入，但没有多轮 recent_stop_plans 证明同一不可修复障碍；已保守阻止停止。", resetOnAllow: false };
	}
	return { allowed: false, reason, resetOnAllow: false };
}

const VERDICT_ACTIONS: readonly StopVerdictAction[] = ["WaitForAsyncWork", "HumanIntervention", "ArrangeObservation"];

export function isValidStopVerdict(value: unknown): value is StopAnalysisVerdict {
	if (!isAdmissionObject(value)) return false;
	const action = value.action;
	return typeof action === "string" && (VERDICT_ACTIONS as readonly string[]).includes(action) && typeof value.reason === "string";
}

const STOP_SCHEMA = {
	type: "object",
	properties: {
		action: { type: "string", enum: ["WaitForAsyncWork", "HumanIntervention", "ArrangeObservation"] },
		reason: { type: "string" },
	},
	required: ["action", "reason"],
	additionalProperties: false,
};
const stopValidate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(STOP_SCHEMA);

/** Upstream stop_judge_verdict: judge with evidence snapshot + facts; OC model semantics = host default. */
export async function runStopAnalysis(judges: JudgeSessions, sid: string, facts: StopRouteFacts, evidenceDir: string | null): Promise<StopAnalysisVerdict | { error: string }> {
		const system = [
		"你是 FSM Stop 分析评审（FSM-STOP-ANALYSIS）。判定该 agent 现在停止是否合法。",
		"只允许输出结构化结论：action ∈ WaitForAsyncWork（有异步工作在跑，允许停）、HumanIntervention（同一障碍多轮未解，允许停等人工）、ArrangeObservation（应继续并安排观察，阻止停）。",
	].join("\n");
	const user = [
		`FSM: ${facts.fsmName ?? "?"} 状态: ${facts.stateId ?? "?"} 退出态: ${facts.noProgress}`,
		`no-progress 次数: ${facts.noProgress}`,
		`异步工作在跑: ${facts.liveWork ? "是" : "否"}`,
		facts.recentPlans.length > 0 ? `最近停止计划:\n${facts.recentPlans.map((plan, index) => `${index + 1}. ${plan}`).join("\n")}` : "最近停止计划: 无",
		`最后一条 assistant 消息:\n${facts.lastAssistantMessage ?? "（无）"}`,
		...(evidenceDir ? [`Evidence 目录: ${evidenceDir}（可用 read/grep/glob 工具查阅）`] : []),
	].join("\n\n");
	try {
		const envelope = await judges.run(sid, { system, user, schema: STOP_SCHEMA, validate: stopValidate,
			tools: { "*": false, StructuredOutput: true, read: true, grep: true, glob: true },
			...(evidenceDir ? { addDirs: [evidenceDir] } : {}) } as Parameters<JudgeSessions["run"]>[1]);
		const captured = (envelope.parts ?? []).filter((part: OcPart) => part.type === "tool" && part.tool === "StructuredOutput"
			&& (part as { state?: { status?: string } }).state?.status === "completed")
			.map((part) => (part as { state?: { input?: unknown } }).state?.input)
			.find((input) => isValidStopVerdict(input));
		if (!captured) return { error: "judge produced no valid structured verdict" };
		return captured;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "judge failed" };
	}
}

export interface StopEvidenceSnapshot {
	readonly dir: string | null;
	readonly liveWork: boolean;
}

export async function collectStopEvidence(request: DaemonRequester, binding: { sessionId: string; agentId: string }, deadline: number): Promise<StopEvidenceSnapshot> {
	const [collect, live] = await Promise.all([
		request({ method: "POST", path: "/evidence/collect", deadline, body: { session_id: binding.sessionId } }).catch(() => null),
		request({ method: "POST", path: "/evidence/live-work", deadline, body: { session_id: binding.sessionId, agent_id: binding.agentId } }).catch(() => null),
	]);
	const dir = collect && isAdmissionObject(collect.body) && typeof collect.body.dir === "string" ? collect.body.dir : null;
	const liveWork = Boolean(live && isAdmissionObject(live.body) && (live.body as { live?: unknown }).live === true);
	return { dir, liveWork };
}

export async function resetStopGate(request: DaemonRequester, binding: { sessionId: string; agentId: string }, deadline: number): Promise<void> {
	await request({ method: "POST", path: "/stop-reset", deadline, body: { session_id: binding.sessionId, agent_id: binding.agentId } }).catch(() => { /* best-effort */ });
}
