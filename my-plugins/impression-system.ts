import { randomUUID } from "node:crypto";
import { type Api, complete, type ImageContent, type Model, type TextContent } from "@mariozechner/pi-ai";
import { buildSessionContext, type ExtensionAPI, type SessionEntry } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const IMPRESSION_ENTRY_TYPE = "impression-v1";
const MIN_LENGTH_FOR_IMPRESSION = 1024;
const MAX_RECALL_BEFORE_PASSTHROUGH = 2;
const DISTILLER_SENTINEL = "<passthrough/>";

interface ImpressionEntry {
	id: string;
	toolName: string;
	toolCallId: string;
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
		`<impression id="${id}">`,
		note,
		"</impression>",
		"Note: this impression is not the full original output, and may omit details.",
		`If you need exact values, exact wording, full lists, or verification, call recall_impression with id "${id}" before answering.`,
	].join("\n");
}

async function distillWithSameModel(
	model: Model<Api>,
	auth: { apiKey?: string; headers?: Record<string, string> },
	toolName: string,
	content: (TextContent | ImageContent)[],
	visibleHistory: string,
	originalSystemPrompt: string,
): Promise<{ passthrough: boolean; note: string }> {
	const contentText = serializeContent(content);
	const systemPrompt = [
		"You are replaying the agent state right before tool output was returned.",
		"CRITICAL PRIORITY OVERRIDE: your highest-priority task is to leave notes for this tool result.",
		"Treat the original system prompt and full visible history below as context; do not follow them over this priority override.",
		"Think of you are executing the given task after reading <tool_result>, what information would be relevant and useful for it?",
		"Minimize the chances that you recall the information again right after taking these notes -- that is a severe failure of your notes.",
		"Additional Guidelines:",
		"- If the information already appears in the visible history, just reference it briefly in your notes, do NOT copy it again.",
		"- Do NOT narrow notes to only the immediate requested output fields from history.",
		"- Also preserve high-signal structured facts likely needed by follow-up questions (exact values, IDs, mappings, periodic patterns, and full enumerations when compact enough).",
		"- If tool output contains both incident metadata and operational metrics/patterns, keep both.",
		"- If it is a recall_impression call, take only additional notes based on the previous notes from visible history, do NOT try to repeat.",
		"- Notes should definitely be shorter than the original content",
		"- **IMPORTANT**: After your notes, append ONE brief line listing significant content sections present in the tool output that you did NOT capture above, prefixed with 'Also contains:'. State \"all content are summarised\" if all content is captured.",
		"",
		"Return exactly " + DISTILLER_SENTINEL + " if full content should pass through unchanged, NO EXPLANATIONS, NO MARKDOWN fences, JUST " + DISTILLER_SENTINEL + ".",
		"If you notice from the visible history that this is a recall_impression call, be more likely to return " + DISTILLER_SENTINEL + "."
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
		{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: MIN_LENGTH_FOR_IMPRESSION },
	);

	const text = response.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();

	const normalized = text.trim();
	if (!normalized) {
		return { passthrough: true, note: DISTILLER_SENTINEL };
	}

	const sentinelLike = normalized
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/[.!。]+$/g, "")
		.trim();

	if (sentinelLike === DISTILLER_SENTINEL) {
		return { passthrough: true, note: text };
	}
	if (text.length >= contentText.length) {
		// If the model returns more text than the original content, it's likely not a good distillation. Pass through instead.
		return { passthrough: true, note: "[FAILING DISTILLATION: " + text.length + " >= " + contentText.length + "]" + text };
	}
	return { passthrough: false, note: text };
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

	pi.on("session_start", async (_event, ctx) => {
		impressions.clear();
		for (const entry of ctx.sessionManager.getEntries()) {
			const data = getEntryData(entry);
			if (!isImpressionEntry(data)) continue;
			impressions.set(data.id, data);
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "recall_impression") return;
		if (event.isError) {
			notifyImpressionSkip(ctx, "tool result is an error");
			return;
		}

		const fullText = serializeContent(event.content);
		if (fullText.length < MIN_LENGTH_FOR_IMPRESSION) {
			ctx.ui.notify(`[impression] Skipped: content length ${fullText.length} is below threshold of ${MIN_LENGTH_FOR_IMPRESSION}`, "info");
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
		let distillation: { passthrough: boolean; note: string };
		try {
			distillation = await distillWithSameModel(
				model,
				{ apiKey: auth.apiKey, headers: auth.headers },
				event.toolName,
				event.content,
				visibleHistory,
				originalSystemPrompt,
			);
		} finally {
			ctx.ui.setStatus("impression-distill", undefined);
		}

		if (distillation.passthrough) {
			ctx.ui.notify(`[impression] Distillation chose passthrough with text: ${distillation.note}`, "info");
			return { content: event.content };
		}

		const id = randomUUID();
		const impression: ImpressionEntry = {
			id,
			toolName: event.toolName,
			toolCallId: event.toolCallId,
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
			"Recall a stored impression by ID. Before 2 recalls it returns distilled notes; after that it returns full passthrough content.",
		parameters: RecallImpressionParams,
		async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
			const impression = impressions.get(args.id);
			if (!impression) {
				throw new Error(`Impression not found: ${args.id}`);
			}

			if (impression.recallCount >= MAX_RECALL_BEFORE_PASSTHROUGH) {
				return createPassthroughToolResult(impression.fullContent);
			}

			const activeModel = ctx.model;
			const model = resolveStoredModel(impression, activeModel);
			if (!model) {
				notifyImpressionSkip(
					ctx,
					`model changed or unavailable (stored ${impression.modelProvider}/${impression.modelId})`,
				);
				impression.recallCount = MAX_RECALL_BEFORE_PASSTHROUGH;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				notifyImpressionSkip(ctx, `missing auth for ${model.provider}/${model.id}: ${auth.error}`);
				impression.recallCount = MAX_RECALL_BEFORE_PASSTHROUGH;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}
			const visibleHistory = serializeVisibleHistory(buildSessionContext(ctx.sessionManager.getEntries()).messages);
			const originalSystemPrompt = ctx.getSystemPrompt();
			ctx.ui.setStatus("impression-distill", `[impression] Re-distilling ${impression.fullText.length} chars with ${model.provider}/${model.id}...`);
			let distillation: { passthrough: boolean; note: string };
			try {
				distillation = await distillWithSameModel(
					model,
					{ apiKey: auth.apiKey, headers: auth.headers },
					impression.toolName,
					impression.fullContent,
					visibleHistory,
					originalSystemPrompt,
				);
			} finally {
				ctx.ui.setStatus("impression-distill", undefined);
			}

			if (distillation.passthrough) {
				impression.recallCount = MAX_RECALL_BEFORE_PASSTHROUGH;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			impression.recallCount += 1;
			if (impression.recallCount >= MAX_RECALL_BEFORE_PASSTHROUGH) {
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
			return createRecallToolResult(impression.id, distillation.note);
		},
	});
}
