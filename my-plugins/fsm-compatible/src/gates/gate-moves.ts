import type { DaemonRequester } from "../broker/daemon-request.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

const QUESTION_TOOL = "AskUserQuestion";

/** Hook gate bisection (main.rs:435-449): only an allowed question tool suppresses; everything else releases. */
export function gateShouldSuppress(allowed: boolean, toolName: string): boolean {
	return allowed && toolName === QUESTION_TOOL;
}

export interface GateMover {
	readonly sessionId: string;
	readonly agentId: string;
}

/** Best-effort main-gate move: failures are abandoned (never retried, never change a verdict). */
export async function moveGate(request: DaemonRequester, mover: GateMover, suppress: boolean, reason: string, deadline: number): Promise<void> {
	if (mover.agentId !== "main") return;
	try {
		await request({ method: "POST", path: suppress ? "/gate/suppress" : "/gate/release", deadline,
			body: { session_id: mover.sessionId, agent_id: "main", reason } });
	} catch {
		// best-effort: a lost suppress under-suppresses (safe); a lost release self-heals on the next main tool.
	}
}

export function gateRoutes(): readonly string[] { return ["/gate/suppress", "/gate/release"]; }

export function isQuestionToolName(toolName: string): boolean { return toolName === QUESTION_TOOL; }

export function assertGateRequestShape(body: unknown): { session_id: string; agent_id: string; reason: string } {
	if (!body || typeof body !== "object" || typeof (body as { session_id?: unknown }).session_id !== "string"
		|| typeof (body as { agent_id?: unknown }).agent_id !== "string" || typeof (body as { reason?: unknown }).reason !== "string") {
		throw new RuntimeError("protocol-invalid");
	}
	return body as { session_id: string; agent_id: string; reason: string };
}
