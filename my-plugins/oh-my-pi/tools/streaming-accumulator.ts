/**
 * streaming-accumulator.ts — subscribes to AgentSession events and
 * accumulates them into AgentToolResult snapshots for onUpdate callbacks.
 *
 * This bridges the gap between session.subscribe() events and the
 * pi TUI's onUpdate → renderResult(isPartial) flow.
 */

import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { type UsageStats, emptyUsageStats } from "./format-tool-call.js";

// ─── Display item types ──────────────────────────────────────────────────────

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> }
	| { type: "toolResult"; name: string; isError: boolean };

// ─── Streaming details ──────────────────────────────────────────────────────

export interface StreamingDetails {
	agent: string;
	model: string;
	sessionId: string;
	status: "running" | "completed" | "error";
	items: DisplayItem[];
	usage: UsageStats;
	currentText: string;
	error?: string;
	inline: boolean;
}

// ─── Throttle helper ─────────────────────────────────────────────────────────

function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
	let lastCall = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const throttled = (...args: Parameters<T>) => {
		const now = Date.now();
		const remaining = ms - (now - lastCall);
		if (remaining <= 0) {
			if (timer) { clearTimeout(timer); timer = undefined; }
			lastCall = now;
			fn(...args);
		} else if (!timer) {
			timer = setTimeout(() => {
				lastCall = Date.now();
				timer = undefined;
				fn(...args);
			}, remaining);
		}
	};
	const cancel = () => {
		if (timer) { clearTimeout(timer); timer = undefined; }
	};
	return { call: throttled as unknown as T, cancel };
}

// ─── Accumulator factory ────────────────────────────────────────────────────

export interface StreamingAccumulator {
	readonly details: StreamingDetails;
	dispose(): void;
}

export function createStreamingAccumulator(
	session: AgentSession,
	onUpdate: AgentToolUpdateCallback<StreamingDetails>,
	agentName: string,
	modelId: string,
	sessionId: string,
): StreamingAccumulator {
	const details: StreamingDetails = {
		agent: agentName,
		model: modelId,
		sessionId,
		status: "running",
		items: [],
		usage: emptyUsageStats(),
		currentText: "",
		inline: true,
	};

	function emitUpdate(): void {
		const result: AgentToolResult<StreamingDetails> = {
			content: [{ type: "text", text: details.currentText || "(running...)" }],
			details,
		};
		try {
			onUpdate(result);
		} catch (_) {
			// Swallow errors from onUpdate to avoid crashing session event loop
		}
	}

	const { call: throttledEmit, cancel: cancelThrottle } = throttle(emitUpdate, 150);

	const unsubscribe = session.subscribe((event) => {
		switch (event.type) {
			case "message_update": {
				// Accumulate streaming text from assistant
				const msg = event.message;
				if (msg.role === "assistant") {
					let text = "";
					for (const part of msg.content) {
						if (part.type === "text") text += part.text;
					}
					details.currentText = text;
					throttledEmit();
				}
				break;
			}
			case "tool_execution_start": {
				details.items.push({
					type: "toolCall",
					name: event.toolName,
					args: event.args as Record<string, unknown>,
				});
				throttledEmit();
				break;
			}
			case "tool_execution_end": {
				details.items.push({
					type: "toolResult",
					name: event.toolName,
					isError: event.isError,
				});
				throttledEmit();
				break;
			}
			case "turn_end": {
				// Flush accumulated text as a display item
				if (details.currentText) {
					details.items.push({ type: "text", text: details.currentText });
					details.currentText = "";
				}
				details.usage.turns++;
				throttledEmit();
				break;
			}
			default:
				break;
		}
	});

	return {
		get details() { return details; },
		dispose() { cancelThrottle(); unsubscribe(); },
	};
}
