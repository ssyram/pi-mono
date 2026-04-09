/**
 * phase-runner.ts — generic sub-session runner for pipeline phases.
 *
 * Creates an isolated agent session, injects a system prompt and tools,
 * drives one turn, and extracts the result from a mandatory "submit" tool call.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	createAgentSession,
	createExtensionRuntime,
	createReadTool,
	createBashTool,
	createGrepTool,
	defineTool,
	SessionManager,
	SettingsManager,
	type ModelRegistry,
	type ResourceLoader,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PhaseRunOptions {
	/** Phase name for logging */
	phaseName: string;
	/** System prompt (with template vars already resolved) */
	systemPrompt: string;
	/** User message to send */
	userMessage: string;
	/** Which built-in tools to provide (default: none) */
	builtinTools?: ("read" | "bash" | "grep")[];
	/** The submit tool definition for structured output */
	submitTool: ToolDefinition<TSchema, unknown, unknown>;
	/** Model to use */
	model: Model<Api>;
	/** Working directory */
	cwd: string;
	/** Model registry from host context (carries auth) */
	modelRegistry: ModelRegistry;
	/** Abort signal */
	signal?: AbortSignal;
}

export interface PhaseRunResult<T = unknown> {
	/** Structured data from the submit tool call */
	data: T | null;
	/** Raw assistant text (for debugging) */
	assistantText: string;
	/** Whether the submit tool was called */
	submitted: boolean;
	/** Token usage */
	tokenUsage: { input: number; output: number };
}

/**
 * Load a prompt template from src/prompts/ and resolve template variables.
 */
export function loadPrompt(promptFile: string, vars: Record<string, string>): string {
	const promptPath = resolve(__dirname, "prompts", promptFile);
	let content = readFileSync(promptPath, "utf-8");
	for (const [key, value] of Object.entries(vars)) {
		content = content.replaceAll(`{{${key}}}`, value);
	}
	return content;
}

/**
 * Run a single pipeline phase in an isolated sub-session.
 */
export async function runPhase<T>(options: PhaseRunOptions): Promise<PhaseRunResult<T>> {
	const {
		phaseName,
		systemPrompt,
		userMessage,
		builtinTools = [],
		submitTool,
		model,
		cwd,
		modelRegistry,
		signal,
	} = options;

	// Capture submit tool output via closure
	let submitData: T | null = null;
	let submitted = false;

	const wrappedSubmitTool = defineTool({
		...submitTool,
		async execute(toolCallId, params, sig, onUpdate, ctx) {
			submitData = params as T;
			submitted = true;
			return {
				content: [{ type: "text" as const, text: `${phaseName} 数据已接收。` }],
				details: undefined,
			};
		},
	});

	// Build builtin tools
	const tools = builtinTools.map((t) => {
		switch (t) {
			case "read": return createReadTool(cwd);
			case "bash": return createBashTool(cwd);
			case "grep": return createGrepTool(cwd);
		}
	});

	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: true, maxRetries: 2 },
	});

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		modelRegistry,
		resourceLoader,
		tools,
		customTools: [wrappedSubmitTool as never],
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager,
	});

	// Wire abort
	if (signal) {
		const handleAbort = () => session.agent.abort();
		signal.addEventListener("abort", handleAbort, { once: true });
	}

	// Drive one turn
	await session.prompt(userMessage, { expandPromptTemplates: false });
	await session.agent.waitForIdle();

	// Extract assistant text for debugging
	const messages = session.agent.state.messages;
	let assistantText = "";
	let totalInput = 0;
	let totalOutput = 0;

	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") {
					assistantText += part.text;
				}
			}
		}
	}

	// Dispose session (one-shot, no reuse)
	session.dispose();

	return {
		data: submitData,
		assistantText,
		submitted,
		tokenUsage: { input: totalInput, output: totalOutput },
	};
}
