import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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

const REVIEWER_WIDGET_KEY = "fsm-compatible-stop-reviewer";
const REVIEWER_FRAME_MS = 800;

/** Reviewer line frame: 1–3 dots cycling every 800ms (`.`, `..`, `...`). */
export function stopReviewerLine(startedAt: number, now: number): string {
	const frame = Math.floor(Math.max(0, now - startedAt) / REVIEWER_FRAME_MS) % 3;
	return `Stop Reviewer Is Running (Esc to stop)${".".repeat(frame + 1)}`;
}

/** Shows the animated reviewer line and routes Esc to `onEscape`; no-op without a UI. */
function mountReviewerUI(ctx: ExtensionContext, onEscape: () => void): () => void {
	const ui = (ctx as { ui?: Partial<ExtensionContext["ui"]> }).ui;
	if (!ui || typeof ui.setWidget !== "function" || typeof ui.onTerminalInput !== "function") return () => {};
	const started = Date.now();
	let tuiRef: { requestRender(): void } | undefined;
	const component = {
		render(_width: number): string[] {
			return [stopReviewerLine(started, Date.now())];
		},
		invalidate(): void {},
	};
	try {
		ui.setWidget(REVIEWER_WIDGET_KEY, (tui: unknown) => {
			tuiRef = tui as { requestRender(): void };
			return component;
		}, { placement: "belowEditor" });
	} catch { return () => {}; }
	const timer = setInterval(() => { tuiRef?.requestRender(); }, REVIEWER_FRAME_MS);
	timer.unref?.();
	const offInput = ui.onTerminalInput((data: string) => {
		if (data === "\x1b") { onEscape(); return { consume: true }; }
		return undefined;
	});
	return () => {
		clearInterval(timer);
		offInput();
		try { ui.setWidget!(REVIEWER_WIDGET_KEY, undefined); } catch { /* host gone */ }
	};
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
		// Every blocked stop forces a continuation turn, so every arm marks the
		// acting session — sessionId for root (agentId "main" is a title, not a
		// directory key), agentId for a child.
		const blockStop = (content: string) => {
			deps?.markStopContinuation?.(current.agentId && current.agentId !== "main" ? current.agentId : current.sessionId);
			return { entries: [{ type: "custom_message" as const, customType: "fsm-compatible:stop",
				content, display: true }], continue: true };
		};
		if (event.outcome !== "completed" || event.continue) return undefined;
		// Pending steering/follow-up means this boundary is not a stop: the queued
		// input starts the next turn regardless, so judging here would block a
		// turn that is not even trying to stop (OC prompt.ts defers on unconsumed
		// input, OC-P:1535–1547). The real stop route runs at the boundary after
		// the queue drains.
		if ((event.context.pendingMessages?.length ?? 0) > 0) return undefined;
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
			return blockStop(`FSM Stop：stop-check 协议错误，已保守阻止停止（${message}）。`);
		}
		if (check.isTerminal) {
			// HC plan_stop_route Allow still ran the hook and emitted a
			// verdict; the dual record keeps that observable fact.
			dualStopLog({ session_id: current.sessionId, agent_id: current.agentId,
				last_assistant_message: lastAssistantText(event.context.contextMessages) ?? undefined,
				decision: "allow",
				reason: `FSM Stop：${check.fsmName ?? "工作流"}当前未处于需要阻止停止的位置（未加载活跃 FSM，或当前状态允许用户交互）；已允许停止。`,
				agent: current.agentId === "main" ? "stop" : "subagent-stop" });
			return undefined;
		}
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
			return blockStop("FSM Stop：状态数据缺失，已保守阻止停止。");
		}
		if (plan.kind === "deterministic") {
			return blockStop(plan.reason);
		}
		// HC plan_stop_route never short-circuits on live work: the judge sees
		// the live-work evidence and decides (wait_for_async_work).
		if (!deps?.judges) {
			ctx.ui.notify("FSM Stop analysis unavailable (no judge model); deterministic fallback", "warning");
			return blockStop("FSM Stop：软门评审不可用，按确定性规则阻止停止。");
		}
		let sid: string;
		try {
			sid = deps.judges.create();
		} catch {
			// Judge pool exhausted or unavailable: fail closed on the deterministic rule
			// instead of crashing the settle boundary.
			ctx.ui.notify("FSM Stop judge unavailable; deterministic fallback", "warning");
			return blockStop("FSM Stop：软门评审不可用，按确定性规则阻止停止。");
		}
		const judges = deps.judges;
		try {
			let interrupted = false;
			const dismount = mountReviewerUI(ctx, () => {
				// Esc is the human overruling the reviewer: abort the analysis,
				// notify the FSM, and ALLOW the stop — any verdict the reviewer
				// still produces is void.
				interrupted = true;
				void judges.abort(sid).catch(() => undefined);
				void request({ method: "POST", path: "/log", deadline: Date.now() + timeoutMs,
					body: { kind: "stop_review_interrupted_human_override" } }).catch(() => { /* best-effort */ });
			});
			try {
				const verdict = await runStopAnalysis(deps.judges, sid, facts, evidence.dir);
				if (interrupted) {
					dualStopLog({ session_id: current.sessionId, agent_id: current.agentId,
						last_assistant_message: facts.lastAssistantMessage, decision: "allow",
						reason: "用户打断评审（Esc）：允许停止。", agent: current.agentId === "main" ? "stop" : "subagent-stop" });
					return undefined;
				}
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
			// child sid — the acting session is the one whose turn continues. Root
			// stops carry agentId "main", which is a title, not a directory key.
			if (interrupted) return undefined;
			return blockStop(decision.reason);
		} finally { dismount(); }
		} finally { deps.judges.release(sid); }
	});
	return off;
}
