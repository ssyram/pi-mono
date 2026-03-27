/**
 * Sub-Agent Calling Extension
 *
 * Registers a `spawn_subagent` tool that allows the LLM to spin up an isolated
 * sub-agent with its own in-memory context to complete a delegated task.
 *
 * Features:
 * - Isolated in-memory session: no persistence, no cross-contamination
 * - Inherits the current model and credentials
 * - Configurable tool access (read-only, coding, or all built-in tools)
 * - Streams sub-agent progress back to the parent via onUpdate
 * - Respects abort signals for cancellation
 *
 * Usage:
 *   "Search the codebase for all usages of X and summarize them"
 *   → LLM calls spawn_subagent({ task: "...", tools: "read-only" })
 *
 *   "Refactor the foo module in isolation"
 *   → LLM calls spawn_subagent({ task: "...", tools: "coding" })
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
	type AgentSessionEvent,
	codingTools,
	createAgentSession,
	type ExtensionAPI,
	findTool,
	grepTool,
	lsTool,
	readOnlyTools,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const TOOLS_DESCRIPTION =
	'Tool preset for the sub-agent. "read-only" (default): read, grep, find, ls. "coding": read, bash, edit, write. "all": all built-in tools.';

const PARAMS = Type.Object({
	task: Type.String({
		description: "The task for the sub-agent to complete. Be specific and self-contained.",
	}),
	tools: Type.Optional(
		Type.Union([Type.Literal("read-only"), Type.Literal("coding"), Type.Literal("all")], {
			description: TOOLS_DESCRIPTION,
		}),
	),
	systemPrompt: Type.Optional(
		Type.String({
			description:
				"Custom system prompt for the sub-agent. If omitted, uses the standard coding agent system prompt.",
		}),
	),
});

function extractText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

export default function subAgentCalling(pi: ExtensionAPI) {
	pi.registerTool({
		name: "spawn_subagent",
		label: "Spawn Sub-Agent",
		description:
			"Spawn an isolated sub-agent with its own fresh context to complete a delegated task. " +
			"The sub-agent runs to completion and returns its final response. " +
			"Useful for parallel exploration, sandboxed refactoring, or offloading focused sub-tasks.",
		promptSnippet: 'spawn_subagent(task: str, tools?: "read-only"|"coding"|"all", systemPrompt?: str) → str',
		promptGuidelines: [
			"Use spawn_subagent to delegate focused sub-tasks that benefit from a clean, isolated context.",
			'Default tools are read-only (read, grep, find, ls). Pass tools="coding" to allow bash/edit/write.',
			"The sub-agent cannot communicate back except via its final text output — make the task self-contained.",
			"Prefer spawn_subagent for exploratory or parallel work to avoid polluting the main context.",
		],
		parameters: PARAMS,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// Resolve tool preset
			const preset = params.tools ?? "read-only";
			const tools =
				preset === "coding"
					? codingTools
					: preset === "all"
						? [...codingTools, grepTool, findTool, lsTool]
						: readOnlyTools;

			// Create isolated in-memory session inheriting model and credentials
			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				model: ctx.model ?? undefined,
				modelRegistry: ctx.modelRegistry,
				sessionManager: SessionManager.inMemory(ctx.cwd),
				tools,
			});

			// Override system prompt if provided
			if (params.systemPrompt) {
				session.agent.setSystemPrompt(params.systemPrompt);
			}

			// Collect streamed assistant text for onUpdate progress reporting
			let lastStreamedText = "";
			let turnCount = 0;
			let toolCallCount = 0;

			const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				if (event.type === "turn_start") {
					turnCount++;
				}
				if (event.type === "tool_execution_start") {
					toolCallCount++;
					onUpdate?.({
						content: [
							{
								type: "text",
								text: `[Sub-agent turn ${turnCount}] Running tool: ${event.toolName}`,
							},
						],
						details: { turnCount, toolCallCount, toolName: event.toolName },
					});
				}
				if (event.type === "message_update" && event.message.role === "assistant") {
					const current = extractText(event.message as AssistantMessage);
					if (current && current !== lastStreamedText && current.length > lastStreamedText.length) {
						lastStreamedText = current;
						onUpdate?.({
							content: [{ type: "text", text: `[Sub-agent streaming]\n${current}` }],
							details: { turnCount, toolCallCount, streaming: true },
						});
					}
				}
			});

			// Propagate abort to the sub-agent
			const handleAbort = () => session.agent.abort();
			signal?.addEventListener("abort", handleAbort);

			let finalMessages: AssistantMessage[] = [];

			try {
				await session.prompt(params.task, { expandPromptTemplates: false });
				await session.agent.waitForIdle();

				// Collect all assistant messages
				finalMessages = session.agent.state.messages.filter((m): m is AssistantMessage => m.role === "assistant");
			} finally {
				signal?.removeEventListener("abort", handleAbort);
				unsubscribe();
				session.dispose();
			}

			// Build the final response from the last assistant message
			const lastAssistant = finalMessages.at(-1);
			if (!lastAssistant) {
				return {
					content: [{ type: "text", text: "Sub-agent completed without producing a response." }],
					details: { turnCount, toolCallCount, messageCount: 0 },
				};
			}

			const responseText = extractText(lastAssistant);
			const summary = [
				`Sub-agent completed in ${turnCount} turn(s) with ${toolCallCount} tool call(s).`,
				"",
				responseText || "(no text output)",
			].join("\n");

			return {
				content: [{ type: "text", text: summary }],
				details: {
					turnCount,
					toolCallCount,
					messageCount: finalMessages.length,
					tools: preset,
				},
			};
		},
	});
}
