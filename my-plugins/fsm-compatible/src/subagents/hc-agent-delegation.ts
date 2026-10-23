import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

export interface HcDelegationLimits {
	readonly maxLines: number;
	readonly maxBytes: number;
}

export const HC_DELEGATION_LIMITS: HcDelegationLimits = Object.freeze({ maxLines: 2000, maxBytes: 50 * 1024 });

export type HcDelegationOutcome = { kind: "completed"; text: string } | { kind: "failed"; text: string } | { kind: "cancelled" };

function escapeMarkup(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&apos;";
		}
	});
}

function bound(value: string, limits: HcDelegationLimits): { text: string; truncated: boolean } {
	const maxLines = Math.max(1, limits.maxLines);
	const maxBytes = Math.max(1, limits.maxBytes);
	let text = "";
	let bytes = 0;
	let lines = 1;
	for (const point of value) {
		if (point === "\n" && lines >= maxLines) break;
		const size = Buffer.byteLength(escapeMarkup(point), "utf8");
		if (bytes + size > maxBytes) break;
		text += point;
		bytes += size;
		if (point === "\n") lines += 1;
	}
	return { text, truncated: text.length < value.length };
}

function visibleText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n\n");
}

export function lastVisibleText(message: AssistantMessage): string {
	const texts = message.content.filter((block): block is { type: "text"; text: string } => block.type === "text");
	return texts.length > 0 ? (texts[texts.length - 1] as { text: string }).text : "";
}

function toolResultText(result: ToolResultMessage): string {
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function hasUsableOutput(message: AssistantMessage, toolResults: readonly ToolResultMessage[]): boolean {
	if (message.content.some((block) => block.type === "text" && block.text.trim().length > 0)) return true;
	return toolResults.some((result) => result.content.length > 0);
}

function formatIncompleteResponse(sessionId: string, finish: "missing" | "unknown"): string {
	return [
		"Subagent task failed: IncompleteResponse",
		`Child session: ${sessionId}`,
		`finish_reason=${finish}`,
		"No visible output or complete tool call was produced",
	].join("\n");
}

function formatOutputLengthFailure(message: AssistantMessage, sessionId: string, limits: HcDelegationLimits): string {
	const text = visibleText(message);
	const output = [
		"Subagent task failed: MessageOutputLengthError",
		`Child session: ${sessionId}`,
		"finish_reason=length",
		`reasoning_tokens=${message.usage.reasoning ?? 0}`,
		`output_tokens=${message.usage.output}`,
		"The task is incomplete; the filesystem and version-control state may contain partial changes.",
	];
	if (!text) {
		output.push("No visible output was produced");
		return output.join("\n");
	}
	const excerpt = bound(text, limits);
	output.push("Partial output excerpt:", excerpt.text);
	if (excerpt.truncated) {
		output.push("", `Partial output truncated. Full content is available in child session ${sessionId}`);
	}
	return output.join("\n");
}

function formatSubagentFailure(errorText: string, sessionId: string, limits: HcDelegationLimits): string {
	const bounded = bound(errorText, limits);
	const output = [`Subagent failed (session_id: ${sessionId}): ${bounded.text}`];
	if (bounded.truncated) {
		output.push("", `Error message truncated. Full context is available in child session ${sessionId}`);
	}
	return output.join("\n");
}

/** HC AgentDelegation.classify over the Pi run projection; order is load-bearing (abort before error). */
export function classifyHcRunOutcome(
	run: { finalAssistant: AssistantMessage | undefined; toolResults: readonly ToolResultMessage[] },
	sessionId: string,
	limits: HcDelegationLimits = HC_DELEGATION_LIMITS,
): HcDelegationOutcome {
	const message = run.finalAssistant;
	if (!message) {
		return { kind: "failed", text: "Task prompt returned a non-assistant result" };
	}
	if (message.stopReason === "aborted") return { kind: "cancelled" };
	if (message.stopReason === "error" || message.stopReason === "length") {
		if (message.stopReason === "length") return { kind: "failed", text: formatOutputLengthFailure(message, sessionId, limits) };
		return { kind: "failed", text: formatSubagentFailure(message.errorMessage ?? "assistant error", sessionId, limits) };
	}
	const failed = run.toolResults.findLast((result) => result.isError);
	if (failed) {
		return { kind: "failed", text: formatSubagentFailure(toolResultText(failed), sessionId, limits) };
	}
	const incomplete = message.stopReason === "pending" || message.stopReason === "deferred" ? "missing" : undefined;
	if (incomplete && !hasUsableOutput(message, run.toolResults)) {
		return { kind: "failed", text: formatIncompleteResponse(sessionId, incomplete) };
	}
	return { kind: "completed", text: lastVisibleText(message) };
}

/** HC AgentDelegation.renderOutput: the synthetic parent notification envelope. */
export function renderAgentNotification(input: {
	sessionId: string;
	state: "running" | "completed" | "error" | "cancelled";
	summary?: string;
	text: string;
}): string {
	const tag = input.state === "error" || input.state === "cancelled" ? "agent_error" : "agent_result";
	return [
		`<agent id="${escapeMarkup(input.sessionId)}" state="${escapeMarkup(input.state)}">`,
		...(input.summary ? [`<summary>${escapeMarkup(input.summary)}</summary>`] : []),
		`<${tag}>`,
		escapeMarkup(input.text),
		`</${tag}>`,
		"</agent>",
	].join("\n");
}
