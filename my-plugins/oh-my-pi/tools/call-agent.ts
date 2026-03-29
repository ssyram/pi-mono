/**
 * call_agent tool — direct agent invocation by name.
 *
 * Bypasses category routing and calls a specific agent directly
 * using that agent's own model configuration.
 */

import { randomUUID } from "node:crypto";
import {
	type ExtensionAPI,
	SessionManager,
	createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import type { AgentDef } from "../agents/types.js";
import { resolvePrompt } from "../agents/types.js";
import { createStreamingAccumulator, type StreamingDetails } from "./streaming-accumulator.js";
import { renderStreamingResult } from "./streaming-renderer.js";
import type { OhMyPiConfig } from "../config.js";
import type { ConcurrencyManager } from "./concurrency.js";
import { resolveModelFromRegistry } from "./resolve-model.js";
import {
	extractText,
	isAbortError,
	resolveToolPreset,
	runWithRetry,
	SessionCache,
	wireCircuitBreaker,
} from "./session-runner.js";

// ─── Session cache ───────────────────────────────────────────────────────────

const sessionCache = new SessionCache();
sessionCache.startCleanup();

// ─── Session cache cleanup export ───────────────────────────────────────────

/** Dispose all cached sessions. Called on session_shutdown. */
export function disposeCallAgentSessions(): void {
	sessionCache.disposeAll();
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerCallAgent(
	pi: ExtensionAPI,
	agents: Map<string, AgentDef>,
	config: OhMyPiConfig,
	concurrency: ConcurrencyManager,
): void {
	// Build the callable agent list dynamically from the agents Map.
	// Include agents with mode "subagent" or "all" — these are designed for
	// sub-agent invocation. Exclude "primary" (top-level orchestrators like
	// Sisyphus/Atlas that should not be called as sub-agents) and "internal"
	// (agents like Prometheus that are only accessed via dedicated commands
	// such as /omp-start, not through the general call_agent interface).
	// Disabled agents are already filtered out of the agents Map by index.ts,
	// so they won't appear here.
	const callableAgentNames = [...agents.values()]
		.filter((a) => a.mode === "subagent" || a.mode === "all")
		.map((a) => a.name) as [string, ...string[]];

	const CallAgentParams = Type.Object({
		agent: StringEnum(callableAgentNames, {
			description: "The agent to call by name",
		}),
		prompt: Type.String({ description: "The prompt to send to the agent" }),
		background: Type.Optional(
			Type.Boolean({ description: "Run in background (default true)" }),
		),
		session_id: Type.Optional(Type.String({ description: "Reuse an existing sub-agent session by ID" })),
	});

	pi.registerTool({
		name: "call_agent",
		label: "Call Agent",
		description:
			"Call a specific agent by name with a prompt. " +
			"Bypasses category routing — uses the agent's own model and persona. " +
			"Runs in background by default; returns a job ID for tracking.",
		promptSnippet:
			`call_agent(agent: ${callableAgentNames.map((n) => `"${n}"`).join("|")}, prompt: str, background?: bool, session_id?: str) -> str | job_id`,
		promptGuidelines: [
			"Use call_agent when you want a specific agent persona — e.g. oracle for research, hephaestus for deep autonomous work.",
			"Unlike delegate_task, call_agent does NOT go through category routing; the agent's own model is used.",
			"Tasks run in background by default. Use background=false only when you need the result immediately.",
			"Pass session_id from a previous result to continue a conversation with the same sub-agent session (preserves context/history).",
		],
		parameters: CallAgentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// 0. Validate session_id + background mutual exclusivity
			if (params.session_id && params.background !== false) {
				return {
					content: [{ type: "text", text: "Error: session_id cannot be used with background mode. Set background=false to reuse a session." }],
					details: undefined,
				};
			}

			// 1. Look up agent
			const agentDef = agents.get(params.agent);
			if (!agentDef) {
				return {
					content: [
						{
							type: "text",
							text: `Error: Agent "${params.agent}" not found. Available: ${callableAgentNames.join(", ")}`,
						},
					],
					details: undefined,
				};
			}

			// 2. Resolve tools
			const tools = resolveToolPreset(agentDef.toolPreset);

			// 3. Resolve model from agent's own model config
			const modelString = agentDef.model;
			const available = ctx.modelRegistry.getAvailable();

			if (!ctx.model) {
				return {
					content: [
						{
							type: "text",
							text: `Error: no model found matching "${modelString}" and no fallback model available`,
						},
					],
					details: undefined,
				};
			}

			const { model: resolvedModel, warning: modelWarning } = resolveModelFromRegistry(
				modelString,
				available,
				ctx.model,
				agentDef.fallbackModels,
				config.default_model,
			);

			// 4. Resolve prompt variant
			const systemPrompt = resolvePrompt(agentDef, resolvedModel);

			// 5. Session continuation: check for existing session
			const providedSessionId = params.session_id;
			const cachedEntry = providedSessionId ? sessionCache.get(providedSessionId) : undefined;

			// Warn if session_id was provided but not found in cache
			const sessionMissWarning = providedSessionId && !cachedEntry
				? "Note: session_id not found in cache, created new session. "
				: "";

			// Generate a session key for new sessions
			const sessionKey = providedSessionId && cachedEntry
				? providedSessionId
				: `${params.agent}-${randomUUID().slice(0, 8)}`;

			// 6. Build runner with retry
			const isForeground = params.background === false;
			const runner = async (signal: AbortSignal): Promise<string> => {
				return runWithRetry(async () => {
					// Look up cached session inside retry loop (may have been invalidated on previous attempt)
					const currentCachedEntry = sessionCache.get(sessionKey);
					let session: NonNullable<ReturnType<typeof sessionCache.get>>["session"];

					if (currentCachedEntry) {
						// Reuse existing session
						session = currentCachedEntry.session;
						sessionCache.touch(sessionKey);
					} else {
						// Create new session
						const result = await createAgentSession({
							cwd: ctx.cwd,
							model: resolvedModel,
							modelRegistry: ctx.modelRegistry,
							sessionManager: SessionManager.inMemory(ctx.cwd),
							tools,
						});
						session = result.session;
						session.agent.setSystemPrompt(`[AGENT:${params.agent}]\n\n` + systemPrompt);

						// Store in cache for future continuation
						sessionCache.set(sessionKey, session);
					}

					// Wire up abort signal to cancel the sub-agent
					const handleAbort = () => { session.agent.abort(); };
					signal.addEventListener("abort", handleAbort);

					if (signal.aborted) {
						signal.removeEventListener("abort", handleAbort);
						// C2: Immediately remove from cache and dispose on abort
						sessionCache.deleteIfMatch(sessionKey, session);
						session.dispose();
						throw new DOMException("The operation was aborted", "AbortError");
					}

					// Circuit breaker: detect repeated identical tool calls
					// M9: Circuit breaker aborts produce the same AbortError path
					const circuitBreaker = wireCircuitBreaker(session);

					// Wire streaming accumulator for foreground execution
					const accumulator = isForeground && onUpdate
						? createStreamingAccumulator(session, onUpdate, params.agent, resolvedModel.id, sessionKey)
						: undefined;

					try {
						await session.prompt(params.prompt, {
							expandPromptTemplates: false,
						});
						await session.agent.waitForIdle();

						// C2: If signal was aborted during execution, clean up immediately
						if (signal.aborted) {
							sessionCache.deleteIfMatch(sessionKey, session);
							session.dispose();
							throw new DOMException("The operation was aborted", "AbortError");
						}

						const finalMessages =
							session.agent.state.messages.filter(
								(m: { role: string }): m is AssistantMessage =>
									m.role === "assistant",
							);
						const lastAssistant = finalMessages.at(-1);
						return lastAssistant
							? extractText(lastAssistant)
							: "(no output)";
					} catch (err) {
						accumulator?.dispose();
						// On error, invalidate the cached session so retries create fresh ones
						sessionCache.deleteIfMatch(sessionKey, session);
						// Always dispose on error — either we just created it or we removed it from cache
						session.dispose();
						// M9: If circuit breaker tripped, wrap as AbortError so C1 skips retry
						if (circuitBreaker.tripped && !isAbortError(err)) {
							const abortErr = new DOMException(
								`Circuit breaker tripped: ${err instanceof Error ? err.message : String(err)}`,
								"AbortError",
							);
							throw abortErr;
						}
						throw err;
					} finally {
						accumulator?.dispose();
						circuitBreaker.unsubscribe();
						signal.removeEventListener("abort", handleAbort);
					}
					// Session is NOT disposed — kept in cache for continuation
				}, 10, 1000, signal);
			};

			// 7. Submit or run inline
			const runInBackground = params.background !== false;

			if (runInBackground) {
				let jobId: string;
				try {
					jobId = concurrency.submit(
						params.prompt,
						params.agent,
						resolvedModel.id,
						runner,
					);
				} catch (err: unknown) {
					// Catch maxTotal limit from ConcurrencyManager
					const message = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `Error: ${message}` }],
						details: undefined,
					};
				}
				const warningLine = modelWarning ? `\n⚠️ ${modelWarning}` : "";
				return {
					content: [
						{
							type: "text",
							text: `${sessionMissWarning}Calling ${agentDef.displayName} (${resolvedModel.id}) in background.\nJob ID: ${jobId}\nSession ID: ${sessionKey}\nUse background_task(status, jobId) to check progress.${warningLine}`,
						},
					],
					details: {
						jobId,
						agent: params.agent,
						model: resolvedModel.id,
						sessionId: sessionKey,
						modelWarning,
					},
				};
			}

			// Foreground execution
			try {
				const result = await runner(signal ?? new AbortController().signal);
				const warningPrefix = modelWarning ? `\u26A0\uFE0F ${modelWarning}\n\n` : "";
				const finalDetails: StreamingDetails = {
					agent: params.agent,
					model: resolvedModel.id,
					sessionId: sessionKey,
					status: "completed",
					items: [{ type: "text", text: result }],
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					currentText: "",
					inline: true,
				};
				return {
					content: [{ type: "text", text: sessionMissWarning + warningPrefix + result }],
					details: finalDetails,
				};
			} catch (err: unknown) {
				const message =
					err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Error calling ${agentDef.displayName}: ${message}`,
						},
					],
					details: {
						agent: params.agent,
						model: resolvedModel.id,
						sessionId: sessionKey,
						status: "error" as const,
						items: [],
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
						currentText: "",
						error: message,
						inline: true,
					} satisfies StreamingDetails,
				};
			}
		},

		renderCall(args, theme, _context) {
			const promptPreview =
				args.prompt.length > 60
					? args.prompt.slice(0, 57) + "..."
					: args.prompt;
			const bg =
				args.background === false
					? theme.fg("warning", " sync")
					: theme.fg("dim", " bg");
			const text =
				theme.fg("toolTitle", theme.bold("call ")) +
				theme.fg("accent", args.agent) +
				bg +
				"\n" +
				theme.fg("muted", `  "${promptPreview}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, options, theme, _context) {
			const details = result.details as
				| (StreamingDetails & { jobId?: string })
				| { jobId: string; agent: string; model: string; sessionId: string; modelWarning?: string }
				| undefined;

			// Background job result -- no streaming
			if (details && "jobId" in details && details.jobId) {
				return new Text(
					theme.fg("success", "Queued ") +
						theme.fg("accent", details.jobId.slice(0, 8)) +
						theme.fg("dim", ` -> ${details.agent} (${details.model})`),
					0,
					0,
				);
			}

			// Streaming/completed inline result
			if (details && "status" in details) {
				return renderStreamingResult(
					result as AgentToolResult<StreamingDetails>,
					{ expanded: options.expanded, isPartial: options.isPartial },
					theme,
				);
			}

			// Fallback
			const t = result.content[0];
			const text = t?.type === "text" ? t.text : "";
			const preview =
				text.length > 120 ? text.slice(0, 117) + "..." : text;
			return new Text(
				theme.fg("success", "Done ") + theme.fg("muted", preview),
				0,
				0,
			);
		},
	});
}
