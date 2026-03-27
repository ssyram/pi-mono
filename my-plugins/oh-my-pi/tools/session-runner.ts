/**
 * session-runner.ts — shared helpers for delegate-task and call-agent.
 *
 * Extracted utilities: abort detection, retry, text extraction,
 * tool-preset resolution, session cache, and circuit breaker.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
	codingTools,
	type CreateAgentSessionResult,
	findTool,
	grepTool,
	lsTool,
	readOnlyTools,
} from "@mariozechner/pi-coding-agent";

import type { AgentDef } from "../agents/types.js";

// ─── Abort detection helper ─────────────────────────────────────────────────

export function isAbortError(err: unknown): boolean {
	if (err instanceof DOMException && err.name === "AbortError") return true;
	if (err instanceof Error && err.name === "AbortError") return true;
	return false;
}

// ─── Retry helper ────────────────────────────────────────────────────────────

export async function runWithRetry(
	fn: () => Promise<string>,
	maxRetries: number = 10,
	baseDelayMs: number = 1000,
	signal?: AbortSignal,
): Promise<string> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		// M8: Check signal.aborted BEFORE each attempt to avoid creating wasted sessions
		if (signal?.aborted) {
			throw lastError ?? new DOMException("The operation was aborted", "AbortError");
		}
		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			// C1: Never retry AbortErrors or when signal is aborted
			if (isAbortError(err) || signal?.aborted) {
				throw lastError;
			}
			if (attempt < maxRetries) {
				const delay = baseDelayMs * Math.pow(2, Math.min(attempt, 5)); // 1s → 32s max
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, delay);
					if (signal) {
						const onAbort = () => { clearTimeout(timer); resolve(); };
						signal.addEventListener("abort", onAbort, { once: true });
					}
				});
				// Re-check abort after waking from sleep
				if (signal?.aborted) {
					throw lastError ?? new DOMException("The operation was aborted", "AbortError");
				}
			}
		}
	}
	throw lastError!;
}

// ─── Text extraction ─────────────────────────────────────────────────────────

export function extractText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

// ─── Tool preset resolution ─────────────────────────────────────────────────

export function resolveToolPreset(preset: AgentDef["toolPreset"]) {
	switch (preset) {
		case "read-only":
			return readOnlyTools;
		case "coding":
			return codingTools;
		case "all":
			return [...codingTools, grepTool, findTool, lsTool];
		default:
			console.warn(`[session-runner] Unknown tool preset "${preset}", falling back to coding tools`);
			return codingTools;
	}
}

// ─── Session cache ───────────────────────────────────────────────────────────

interface CachedSessionEntry {
	session: CreateAgentSessionResult["session"];
	lastUsed: number;
}

export class SessionCache {
	private cache = new Map<string, CachedSessionEntry>();
	private cleanupTimer: ReturnType<typeof setInterval> | undefined;

	get(key: string): CachedSessionEntry | undefined {
		return this.cache.get(key);
	}

	set(key: string, session: CreateAgentSessionResult["session"]): void {
		this.cache.set(key, { session, lastUsed: Date.now() });
	}

	touch(key: string): void {
		const entry = this.cache.get(key);
		if (entry) entry.lastUsed = Date.now();
	}

	delete(key: string): void {
		this.cache.delete(key);
	}

	/** Remove from cache only if the stored session matches. */
	deleteIfMatch(key: string, session: CreateAgentSessionResult["session"]): void {
		const cached = this.cache.get(key);
		if (cached?.session === session) {
			this.cache.delete(key);
		}
	}

	/** Start periodic TTL-based eviction.
	 *
	 * NOTE: The 10-minute default TTL is the primary mitigation against mid-execution disposal.
	 * Sessions are `touch()`-ed at the start of each use (in delegate-task/call-agent runners),
	 * which resets their TTL clock. A session can only be evicted if it has been idle for the
	 * full TTL window. A more robust approach would track "in-use" state explicitly, but the
	 * overhead is not warranted given that typical sub-agent executions complete well within
	 * the 10-minute window.
	 */
	startCleanup(ttlMs: number = 10 * 60 * 1000, intervalMs: number = 5 * 60 * 1000): void {
		if (this.cleanupTimer) return;
		this.cleanupTimer = setInterval(() => {
			const now = Date.now();
			for (const [key, entry] of this.cache) {
				if (now - entry.lastUsed > ttlMs) {
					entry.session.dispose();
					this.cache.delete(key);
				}
			}
		}, intervalMs);
		// Don't keep the process alive just for cleanup
		if (this.cleanupTimer.unref) {
			this.cleanupTimer.unref();
		}
	}

	/** Dispose all cached sessions and clear the cache. */
	disposeAll(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
		for (const [key, entry] of this.cache) {
			entry.session.dispose();
			this.cache.delete(key);
		}
	}
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

export interface CircuitBreakerHandle {
	readonly tripped: boolean;
	unsubscribe(): void;
}

/**
 * Subscribe to a session and detect repeated identical tool calls.
 * When `maxRepeated` consecutive identical calls are detected, aborts the session.
 */
export function wireCircuitBreaker(
	session: CreateAgentSessionResult["session"],
	maxRepeated: number = 3,
): CircuitBreakerHandle {
	let tripped = false;
	const toolCallHistory: string[] = [];

	const unsubscribe = session.subscribe((event) => {
		if (event.type === "tool_execution_start") {
			const key = `${event.toolName}:${JSON.stringify(event.args).slice(0, 200)}`;
			toolCallHistory.push(key);
			if (toolCallHistory.length >= maxRepeated) {
				const last = toolCallHistory.slice(-maxRepeated);
				if (last.every((k) => k === last[0])) {
					tripped = true;
					session.agent.abort();
				}
			}
		}
	});

	return {
		get tripped() {
			return tripped;
		},
		unsubscribe,
	};
}
