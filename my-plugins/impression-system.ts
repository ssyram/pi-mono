/**
 * Impression System — pi extension that distills long tool results into
 * compact notes, storing the originals for on-demand recall.
 *
 * How it works:
 *   1. Intercepts every tool_result whose text length >= MIN_LENGTH_FOR_IMPRESSION.
 *   2. Calls the active model to produce a shorter "impression" (distilled note).
 *   3. Replaces the tool result with the impression; the full content is stored
 *      in session entries and can be retrieved via the `recall_impression` tool.
 *   4. On the first recall, the model re-distills with updated context.
 *      After MAX_RECALL_BEFORE_PASSTHROUGH recalls, full content is returned as-is.
 *
 * Configuration — .pi/impression.json
 *
 *   Optional. If the file is missing or invalid the extension uses defaults.
 *   The config is reloaded on every session_start.
 *
 *   {
 *     "skipDistillation": string[],        // tool names whose results should never be distilled
 *     "minLength":        number,           // minimum text length to trigger distillation (default: 2048)
 *     "maxRecallBeforePassthrough": number  // recalls before returning full content (default: 1)
 *   }
 *
 *   skipDistillation patterns:
 *     - Exact match:  "bash"          — skips only the tool named "bash"
 *     - Glob suffix:  "background_*"  — skips any tool whose name starts with "background_"
 *
 *   Example .pi/impression.json:
 *
 *   {
 *     "skipDistillation": ["bash", "background_output", "my_custom_tool*"],
 *     "minLength": 1024,
 *     "maxRecallBeforePassthrough": 2
 *   }
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Api, complete, type ImageContent, type Model, type TextContent } from "@mariozechner/pi-ai";
import { buildSessionContext, type ExtensionAPI, type SessionEntry, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const IMPRESSION_ENTRY_TYPE = "impression-v1";
const DEFAULT_MIN_LENGTH = 2048;
const DEFAULT_MAX_RECALL = 1;
const DISTILLER_SENTINEL = "<passthrough/>";
const CONFIG_FILE_NAME = "impression.json";

interface ImpressionConfig {
	skipDistillation?: string[];
	minLength?: number;
	maxRecallBeforePassthrough?: number;
}

interface ResolvedConfig {
	skipDistillation: string[];
	minLength: number;
	maxRecall: number;
}

function resolveConfig(raw: ImpressionConfig): ResolvedConfig {
	return {
		skipDistillation: raw.skipDistillation ?? [],
		minLength: raw.minLength ?? DEFAULT_MIN_LENGTH,
		maxRecall: raw.maxRecallBeforePassthrough ?? DEFAULT_MAX_RECALL,
	};
}

function loadConfig(): ImpressionConfig {
	try {
		const configPath = join(process.cwd(), ".pi", CONFIG_FILE_NAME);
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return parsed as ImpressionConfig;
		}
	} catch {
		// Config file missing or invalid — use defaults
	}
	return {};
}

function shouldSkipDistillation(toolName: string, config: ResolvedConfig): boolean {
	const patterns = config.skipDistillation;
	if (patterns.length === 0) return false;
	for (const pattern of patterns) {
		if (pattern === toolName) return true;
		// Support simple glob: "prefix*" matches any tool starting with prefix
		if (pattern.endsWith("*") && toolName.startsWith(pattern.slice(0, -1))) return true;
	}
	return false;
}

interface ImpressionEntry {
	id: string;
	toolName: string;
	toolCallId: string;
	toolInput?: Record<string, unknown>;
	fullContent: (TextContent | ImageContent)[];
	fullText: string;
	recallCount: number;
	createdAt: number;
	modelProvider: string;
	modelId: string;
}

const RecallImpressionParams = Type.Object({
	id: Type.String({ description: "Impression ID" }),
});

function isImpressionEntry(value: unknown): value is ImpressionEntry {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string") return false;
	if (typeof record.toolName !== "string") return false;
	if (typeof record.toolCallId !== "string") return false;
	if (!Array.isArray(record.fullContent)) return false;
	if (typeof record.fullText !== "string") return false;
	if (typeof record.recallCount !== "number") return false;
	if (typeof record.createdAt !== "number") return false;
	if (typeof record.modelProvider !== "string") return false;
	if (typeof record.modelId !== "string") return false;
	return true;
}

function getEntryData(entry: SessionEntry): unknown {
	if (entry.type !== "custom") return undefined;
	if (entry.customType !== IMPRESSION_ENTRY_TYPE) return undefined;
	return entry.data;
}

function serializeContent(content: (TextContent | ImageContent)[]): string {
	const lines: string[] = [];
	for (const block of content) {
		if (block.type === "text") {
			lines.push(block.text);
			continue;
		}
		lines.push(`[image: ${block.mimeType}]`);
	}
	return lines.join("\n").trim();
}

function buildImpressionText(id: string, note: string): string {
	return [
		`🧠 [MY INTERNAL MEMORY | ID: ${id}]`,                                                                                                                                                                                                      
         "I have already processed the raw output of this tool in the background for further processing.",
         "I trust these notes completely (EXCEPT WHEN REPORTING ERRORS). They are sufficient for all reasoning, planning, and answering for the CURRENT needs.",
         "",
         "--- MY NOTES ---",
         note,
         "----------------",
         "",
         "🛑 CRITICAL INSTRUCTION FOR MYSELF:",
         "- I MUST NOT call `recall_impression` just to 'verify' or 'get more context'.",
		 "- If my notes above contain specific read instructions (e.g., `read(offset=X, limit=Y)`), for `edit`/`write`, I MUST use those (or a slightly larger range) to get exact text — NOT `recall_impression`.",
         "- I should ONLY use `recall_impression` when my notes lack the information I need OR no read instructions are provided for the relevant section."
	].join("\n");
}

async function distillWithSameModel(
	model: Model<Api>,
	auth: { apiKey?: string; headers?: Record<string, string> },
	toolName: string,
	content: (TextContent | ImageContent)[],
	visibleHistory: string,
	originalSystemPrompt: string,
	maxTokens: number,
	signal?: AbortSignal,
): Promise<{ passthrough: boolean; note: string; thinking?: string }> {
	const contentText = serializeContent(content);
	const systemPrompt = [
		"You are the same agent as the one in the visible history — the same identity, the same mind.",
		"You are about to receive a tool result. Your outer self (the main thread) will only see what you write here, not the original content.",
		"Think of this as choosing what to remember: you are compressing your own memory, not summarizing for someone else.",
		"You can see the visible history, but ONLY to understand what your outer self is working on and what level of detail they need. Your notes must be grounded ONLY in the <tool_result> content — history provides intent context, not reasoning material. NEVER synthesize conclusions by combining tool output with conversation history.",
		"Your goal: with your notes, your outer self should be able to continue working without needing to recall the original immediately — immediate recall is a **failure** of your compression.",
		"New content length: " + contentText.length + " characters" + (contentText.length > maxTokens * 10 ? " (considered very long, more aggressive compression expected)" : contentText.length < maxTokens * 4 ? " (considered relatively short)" : "") +
		"",
		"Thinking:",
		"- You MAY reason freely inside <thinking>...</thinking> tags. These will be stripped from the final impression and shown separately — use them as much as you need.",
		"- Everything OUTSIDE <thinking> tags is the impression your outer self will see. It must be clean, actionable, and free of meta-commentary.",
		"- NEVER write reasoning, self-reflection, or intent analysis outside <thinking> tags. No 'The outer self wants to...', no 'I should...'. Only tool result content and action guidance.",
		"",
		"Action-awareness:",
		"- Inside <thinking>, reason about what kind of information your outer self needs from this tool result (verbatim text? structural overview? specific values?).",
		"- If the next action needs precise original text (e.g., file editing, code writing, command execution):",
		"  (a) For long output: give navigation guidance so your outer self can re-read only what's needed — e.g., 'Function signature to edit is at lines 153-160. Use read(offset=153, limit=10) to get the exact text.' Do NOT attempt to quote verbatim — your reproduction may have errors. Always direct your outer self to read the original.",
		"  (b) For short output or when the entire content is operationally needed, especially when already in more precise reading as per your guidance in (a): return " + DISTILLER_SENTINEL + " to pass through unchanged.",
		"- If the same file/content was read earlier in visible history, focus on what is NEW or DIFFERENT in this tool result compared to the earlier read. Do NOT synthesize or advise.",
		"- If the next action is analytical (understanding, answering, planning): compress aggressively — semantic notes suffice.",
		"- Action guidance must focus SOLELY on navigating or using the <tool_result> content (e.g., 'key logic at lines X-Y', 'recall needed for editing'). Do NOT answer questions from the conversation history, do NOT diagnose problems by combining tool output with history context, and do NOT draw conclusions that require information beyond what the tool result contains.",
		"",
		"Compression guidelines:",
		"- If specific data from the tool output is identical to something already in visible history, you may write 'already seen in history' instead of repeating — but NEVER add new analysis or conclusions based on history.",
		"- On a recall_impression call, take only additional notes on top of what is already in your visible history — do NOT repeat.",
		"- Your notes must be shorter than the original content.",
		"- After your notes, append ONE brief line prefixed with 'Also contains:' listing significant sections you did NOT capture. State \"all content are summarised\" if nothing was omitted.",
		"",
		"Return exactly " + DISTILLER_SENTINEL + " if full content are very much relevant for further actions and should pass through unchanged. NO EXPLANATIONS, NO MARKDOWN fences, JUST " + DISTILLER_SENTINEL + ".",
	].join("\n");
	const prompt = [
		"<original_system_prompt>",
		originalSystemPrompt || "[none]",
		"</original_system_prompt>",
		"",
		"<visible_history_before_tool_result>",
		visibleHistory || "[none]",
		"</visible_history_before_tool_result>",
		"",
		`Tool: ${toolName}`,
		"",
		"<tool_result>",
		contentText || "[empty]",
		"</tool_result>",
	].join("\n");

	const response = await complete(
		model,
		{
			systemPrompt,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, maxTokens, signal },
	);

	const text = response.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();

	// Extract and strip <thinking> blocks
	const thinkingBlocks: string[] = [];
	const strippedText = text.replace(/<thinking>([\s\S]*?)<\/thinking>/g, (_match, content) => {
		thinkingBlocks.push(content.trim());
		return "";
	}).trim();
	const thinking = thinkingBlocks.length > 0 ? thinkingBlocks.join("\n") : undefined;

	const normalized = strippedText.trim();
	if (!normalized) {
		return { passthrough: true, note: DISTILLER_SENTINEL, thinking };
	}

	const sentinelLike = normalized
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/[.!。]+$/g, "")
		.trim();

	if (sentinelLike === DISTILLER_SENTINEL) {
		return { passthrough: true, note: strippedText, thinking };
	}
	if (strippedText.length >= contentText.length) {
		// If the model returns more text than the original content, it's likely not a good distillation. Pass through instead.
		return { passthrough: true, note: "[FAILING DISTILLATION: " + strippedText.length + " >= " + contentText.length + "]" + strippedText, thinking };
	}
	return { passthrough: false, note: strippedText, thinking };
}

function createRecallToolResult(id: string, note: string): { content: TextContent[]; details: undefined } {
	return {
		content: [{ type: "text", text: buildImpressionText(id, note) }],
		details: undefined,
	};
}

function createPassthroughToolResult(content: (TextContent | ImageContent)[]): {
	content: (TextContent | ImageContent)[];
	details: undefined;
} {
	return {
		content,
		details: undefined,
	};
}

function resolveStoredModel(entry: ImpressionEntry, currentModel: Model<Api> | undefined): Model<Api> | undefined {
	if (currentModel && currentModel.provider === entry.modelProvider && currentModel.id === entry.modelId) {
		return currentModel;
	}
	return undefined;
}

function serializeVisibleHistory(messages: ReturnType<typeof buildSessionContext>["messages"]): string {
	return messages.map((m) => JSON.stringify(m)).join("\n");
}

function formatOriginalCall(entry: ImpressionEntry, theme: Theme): string {
	const input = entry.toolInput;
	const name = theme.fg("toolTitle", theme.bold(entry.toolName));
	if (!input || Object.keys(input).length === 0) return name;

	switch (entry.toolName) {
		case "read": {
			const path = (input.file_path ?? input.path) as string | undefined;
			if (!path) return name;
			const offset = input.offset as number | undefined;
			const limit = input.limit as number | undefined;
			let range = "";
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				range = theme.fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return `${name} ${theme.fg("accent", path)}${range}`;
		}
		case "bash": {
			const command = input.command as string | undefined;
			if (!command) return name;
			const display = command.length > 80 ? command.slice(0, 77) + "..." : command;
			return `${name} ${display}`;
		}
		case "write":
		case "edit": {
			const path = (input.file_path ?? input.path) as string | undefined;
			if (!path) return name;
			return `${name} ${theme.fg("accent", path)}`;
		}
		case "grep":
		case "find": {
			const pattern = (input.pattern ?? input.glob) as string | undefined;
			if (!pattern) return name;
			return `${name} ${pattern}`;
		}
		default: {
			const summary = JSON.stringify(input);
			const display = summary.length > 80 ? summary.slice(0, 77) + "..." : summary;
			return `${name} ${theme.fg("muted", display)}`;
		}
	}
}

function notifyImpressionSkip(
	ctx: {
		ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
	},
	reason: string,
): void {
	ctx.ui.notify(`[impression] Skipped: ${reason}`, "warning");
}

export default function (pi: ExtensionAPI) {
	const impressions = new Map<string, ImpressionEntry>();
	let cfg: ResolvedConfig = resolveConfig(loadConfig());

	pi.on("session_start", async (_event, ctx) => {
		cfg = resolveConfig(loadConfig());
		impressions.clear();
		for (const entry of ctx.sessionManager.getEntries()) {
			const data = getEntryData(entry);
			if (!isImpressionEntry(data)) continue;
			impressions.set(data.id, data);
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "recall_impression") return;
		if (shouldSkipDistillation(event.toolName, cfg)) {
			ctx.ui.notify(`[impression] Skipped distillation for "${event.toolName}" (configured in ${CONFIG_FILE_NAME})`, "info");
			return;
		}
		if (event.isError) {
			notifyImpressionSkip(ctx, "tool result is an error");
			return;
		}

		const fullText = serializeContent(event.content);
		if (fullText.length < cfg.minLength) {
			ctx.ui.notify(`[impression] Skipped: content length ${fullText.length} is below threshold of ${cfg.minLength}`, "info");
			return;
		}

		const model = ctx.model;
		if (!model) {
			notifyImpressionSkip(ctx, "no active model selected");
			return {
				content: event.content,
			};
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			notifyImpressionSkip(ctx, `missing auth for ${model.provider}/${model.id}: ${auth.error}`);
			return {
				content: event.content,
			};
		}
		const visibleHistory = serializeVisibleHistory(buildSessionContext(ctx.sessionManager.getEntries()).messages);
		const originalSystemPrompt = ctx.getSystemPrompt();
		ctx.ui.setStatus("impression-distill", `[impression] Distilling ${fullText.length} chars with ${model.provider}/${model.id}...`);
		let distillation: { passthrough: boolean; note: string; thinking?: string };
		try {
			distillation = await distillWithSameModel(
				model,
				{ apiKey: auth.apiKey, headers: auth.headers },
				event.toolName,
				event.content,
				visibleHistory,
				originalSystemPrompt,
				Math.max(Math.ceil(cfg.minLength / 2), 1024),
				ctx.signal,
			);
		} finally {
			ctx.ui.setStatus("impression-distill", undefined);
		}

		if (distillation.thinking) {
			ctx.ui.notify(`[impression] Thinking: ${distillation.thinking}`, "info");
		}

		if (distillation.passthrough) {
			ctx.ui.notify(`[impression] Distillation passthrough with text: ${distillation.note}`, "info");
			return { content: event.content };
		}

		const id = randomUUID();
		const impression: ImpressionEntry = {
			id,
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			toolInput: event.input,
			fullContent: event.content,
			fullText,
			recallCount: 0,
			createdAt: Date.now(),
			modelProvider: model.provider,
			modelId: model.id,
		};
		impressions.set(id, impression);
		pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);

		return {
			content: [{ type: "text", text: buildImpressionText(id, distillation.note) }],
		};
	});

	pi.registerTool({
		name: "recall_impression",
		label: "Recall Impression",
		description:
			"Recall a stored impression by ID. Before " + cfg.maxRecall + " recalls it returns distilled notes; after that it returns full passthrough content.",
		parameters: RecallImpressionParams,
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const entry = impressions.get(args.id);
			const title = theme.fg("toolTitle", theme.bold("Recall Impression"));
			const idDisplay = theme.fg("muted", args.id);
			const line1 = `${title} ${idDisplay}`;
			if (entry) {
				const originalCall = formatOriginalCall(entry, theme);
				text.setText(`${line1}\n${theme.fg("muted", "> ")}${originalCall}`);
			} else {
				text.setText(line1);
			}
			return text;
		},
		async execute(_toolCallId, args, signal, _onUpdate, ctx) {
			const impression = impressions.get(args.id);
			if (!impression) {
				throw new Error(`Impression not found: ${args.id}`);
			}

			if (impression.recallCount >= cfg.maxRecall) {
				return createPassthroughToolResult(impression.fullContent);
			}

			const activeModel = ctx.model;
			const model = resolveStoredModel(impression, activeModel);
			if (!model) {
				notifyImpressionSkip(
					ctx,
					`model changed or unavailable (stored ${impression.modelProvider}/${impression.modelId})`,
				);
				impression.recallCount = cfg.maxRecall;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				notifyImpressionSkip(ctx, `missing auth for ${model.provider}/${model.id}: ${auth.error}`);
				impression.recallCount = cfg.maxRecall;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}
			const visibleHistory = serializeVisibleHistory(buildSessionContext(ctx.sessionManager.getEntries()).messages);
			const originalSystemPrompt = ctx.getSystemPrompt();
			ctx.ui.setStatus("impression-distill", `[impression] Re-distilling ${impression.fullText.length} chars with ${model.provider}/${model.id}...`);
			let distillation: { passthrough: boolean; note: string; thinking?: string };
			try {
				distillation = await distillWithSameModel(
					model,
					{ apiKey: auth.apiKey, headers: auth.headers },
					impression.toolName,
					impression.fullContent,
					visibleHistory,
					originalSystemPrompt,
					Math.max(Math.ceil(cfg.minLength / 2), 1024),
					signal,
				);
			} finally {
				ctx.ui.setStatus("impression-distill", undefined);
			}

			if (distillation.thinking) {
				ctx.ui.notify(`[impression] Recall thinking: ${distillation.thinking}`, "info");
			}

			if (distillation.passthrough) {
				impression.recallCount = cfg.maxRecall;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			impression.recallCount += 1;
			if (impression.recallCount >= cfg.maxRecall) {
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
			return createRecallToolResult(impression.id, distillation.note);
		},
	});
}
