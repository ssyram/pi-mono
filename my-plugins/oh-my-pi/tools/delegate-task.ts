/**
 * delegate_task tool — category-based task delegation to agents.
 *
 * Routes tasks through the category system (model + agent preset)
 * with optional overrides, then runs them via ConcurrencyManager.
 */

import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import {
	createAgentSession,
	type ExtensionAPI,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import type { AgentDef } from "../agents/types.js";
import { resolvePrompt } from "../agents/types.js";
import { createStreamingAccumulator, type StreamingDetails } from "./streaming-accumulator.js";
import { renderStreamingResult } from "./streaming-renderer.js";
import type { OhMyPiConfig } from "../config.js";
import { getCategory } from "../config.js";
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
export function disposeDelegateTaskSessions(): void {
	sessionCache.disposeAll();
}

// ─── Parameter schema ────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
	"visual-engineering",
	"ultrabrain",
	"deep",
	"artistry",
	"quick",
	"unspecified-low",
	"unspecified-high",
	"writing",
] as const;

function buildDelegateTaskParams(config: OhMyPiConfig) {
	const configKeys = Object.keys(config.categories ?? {});
	const allCategories = [
		...new Set([...DEFAULT_CATEGORIES, ...configKeys]),
	] as [string, ...string[]];

	return Type.Object({
		task: Type.String({ description: "The task description to delegate" }),
		category: Type.Optional(
			StringEnum(allCategories, {
				description: "Task category for model/agent routing",
			}),
		),
		agent: Type.Optional(Type.String({ description: "Override: specific agent name to use" })),
		background: Type.Optional(Type.Boolean({ description: "Run in background (default true)" })),
		session_id: Type.Optional(Type.String({ description: "Reuse an existing sub-agent session by ID" })),
	});
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerDelegateTask(
	pi: ExtensionAPI,
	agents: Map<string, AgentDef>,
	config: OhMyPiConfig,
	concurrency: ConcurrencyManager,
): void {
	const DelegateTaskParams = buildDelegateTaskParams(config);

	// Build dynamic category list for prompt hints
	const configKeys = Object.keys(config.categories ?? {});
	const allCategoryNames = [...new Set([...DEFAULT_CATEGORIES, ...configKeys])];
	const categoryEnumStr = allCategoryNames.map((c) => `"${c}"`).join("|");
	const categoryDescriptions = allCategoryNames
		.map((c) => {
			const cat = getCategory(config, c);
			return cat ? `${c} (${cat.description})` : c;
		})
		.join(", ");

	pi.registerTool({
		name: "delegate_task",
		label: "Delegate Task",
		description:
			"Delegate a task to a specialized agent via category-based routing. " +
			"Categories determine the model and agent preset. " +
			"Runs in background by default; returns a job ID for tracking.",
		promptSnippet:
			`delegate_task(task: str, category?: ${categoryEnumStr}, agent?: str, background?: bool, session_id?: str) -> str | job_id`,
		promptGuidelines: [
			"Use delegate_task to route work through the category system — each category maps to a model tier and agent persona.",
			`Categories: ${categoryDescriptions}.`,
			"Tasks run in background by default. Use background=false only when you need the result immediately.",
			"Use the agent parameter to override the default agent for a category when a specific persona is needed.",
			"Pass session_id from a previous result to continue a conversation with the same sub-agent session (preserves context/history).",
		],
		parameters: DelegateTaskParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// 0. Validate session_id + background mutual exclusivity
			if (params.session_id && params.background !== false) {
				return {
					content: [{ type: "text", text: "Error: session_id cannot be used with background mode. Set background=false to reuse a session." }],
					details: undefined,
				};
			}

			// 1. Resolve category
			const categoryName = params.category ?? "unspecified-low";
			const categoryConfig = getCategory(config, categoryName);
			if (!categoryConfig) {
				return {
					content: [
						{
							type: "text",
							text: `Error: unknown category "${categoryName}"`,
						},
					],
					details: undefined,
				};
			}

			// 2. Resolve agent (override or category default)
			const agentName = params.agent ?? categoryConfig.agent;
			const agentDef = agents.get(agentName);
			if (!agentDef) {
				return {
					content: [
						{
							type: "text",
							text: `Error: agent "${agentName}" not found. Available: ${[...agents.keys()].join(", ")}`,
						},
					],
					details: undefined,
				};
			}

			// 3. Resolve tools
			const tools = resolveToolPreset(agentDef.toolPreset);

			// 4. Resolve model
			const modelString = categoryConfig.model;
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
				categoryConfig.fallbackModels,
				config.default_model,
			);

			// 5. Resolve prompt variant
			const systemPrompt = resolvePrompt(agentDef, resolvedModel);

			// 6. Session continuation: check for existing session
			const providedSessionId = params.session_id;
			const cachedEntry = providedSessionId ? sessionCache.get(providedSessionId) : undefined;

			// Warn if session_id was provided but not found in cache
			const sessionMissWarning = providedSessionId && !cachedEntry
				? "Note: session_id not found in cache, created new session. "
				: "";

			// Generate a session key for new sessions
			const sessionKey = providedSessionId && cachedEntry
				? providedSessionId
				: `${agentName}-${randomUUID().slice(0, 8)}`;

			// 7. Build runner with retry
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
						const categoryPrompt = categoryConfig.promptAppend ?? "";
						session.agent.setSystemPrompt(`[AGENT:${agentName}]\n\n` + systemPrompt + (categoryPrompt ? "\n\n" + categoryPrompt : ""));

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
						? createStreamingAccumulator(session, onUpdate, agentName, resolvedModel.id, sessionKey)
						: undefined;

					try {
						await session.prompt(params.task, {
							expandPromptTemplates: false,
						});
						await session.agent.waitForIdle();

						// C2: If signal was aborted during execution, clean up immediately
						if (signal.aborted) {
							sessionCache.deleteIfMatch(sessionKey, session);
							session.dispose();
							throw new DOMException("The operation was aborted", "AbortError");
						}

						const finalMessages = session.agent.state.messages.filter(
							(m: { role: string }): m is AssistantMessage => m.role === "assistant",
						);
						const lastAssistant = finalMessages.at(-1);
						return lastAssistant ? extractText(lastAssistant) : "(no output)";
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

			// 8. Submit or run inline
			const runInBackground = params.background !== false;

			if (runInBackground) {
				let jobId: string;
				try {
					jobId = concurrency.submit(params.task, agentName, resolvedModel.id, runner);
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
							text: `${sessionMissWarning}Task delegated to ${agentDef.displayName} (${resolvedModel.id}) in background.\nJob ID: ${jobId}\nCategory: ${categoryName}\nSession ID: ${sessionKey}\nUse background_task(status, jobId) to check progress.${warningLine}`,
						},
					],
					details: {
						jobId,
						agent: agentName,
						model: resolvedModel.id,
						category: categoryName,
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
					agent: agentName,
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
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Error executing task: ${message}`,
						},
					],
					details: {
						agent: agentName,
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
			const cat = args.category ?? "unspecified-low";
			const agent = args.agent ? theme.fg("accent", args.agent) : theme.fg("dim", "auto");
			const bg = args.background === false ? theme.fg("warning", " sync") : theme.fg("dim", " bg");
			const taskPreview = args.task.length > 60 ? args.task.slice(0, 57) + "..." : args.task;
			const text =
				theme.fg("toolTitle", theme.bold("delegate ")) +
				theme.fg("accent", cat) +
				" " +
				agent +
				bg +
				"\n" +
				theme.fg("muted", `  "${taskPreview}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, options, theme, _context) {
			const details = result.details as
				| (StreamingDetails & { jobId?: string })
				| { jobId: string; agent: string; model: string; category: string; sessionId: string; modelWarning?: string }
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
			const preview = text.length > 120 ? text.slice(0, 117) + "..." : text;
			return new Text(theme.fg("success", "Done ") + theme.fg("muted", preview), 0, 0);
		},
	});
}
