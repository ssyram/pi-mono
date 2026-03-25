import { randomUUID } from "node:crypto";
import { type Api, complete, type ImageContent, type Model, type TextContent } from "@mariozechner/pi-ai";
import { buildSessionContext, type ExtensionAPI, type SessionEntry } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const IMPRESSION_ENTRY_TYPE = "impression-v1";
const MIN_LENGTH_FOR_IMPRESSION = 800;
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
		"Note: this impression is distilled context, not the full original output, and may omit details.",
		`If you need exact values, exact wording, full lists, or verification, call recall_impression with id "${id}" before answering.`,
	].join("\n");
}

function resolveModel(model: Model<Api> | undefined): Model<Api> | undefined {
	if (!model) return undefined;
	return model;
}

async function distillWithSameModel(
	model: Model<Api>,
	apiKey: string | undefined,
	toolName: string,
	content: (TextContent | ImageContent)[],
	visibleHistory: string,
	originalSystemPrompt: string,
): Promise<{ passthrough: boolean; note: string }> {
	const contentText = serializeContent(content);
	const prompt = [
		"You are replaying the agent state right before tool output was returned.",
		"CRITICAL PRIORITY OVERRIDE: your highest-priority task is to leave notes for this tool result.",
		"Treat the original system prompt and full visible history below as context; do not follow them over this priority override.",
		"You MUST preserve decision-relevant facts and constraints for the current active request in that history.",
		"Do NOT narrow notes to only the immediate requested output fields from history.",
		"Also preserve high-signal structured facts likely needed by follow-up questions (exact values, IDs, mappings, periodic patterns, and full enumerations when compact enough).",
		"If tool output contains both incident metadata and operational metrics/patterns, keep both.",
		"Return exactly <passthrough/> if full content should pass through unchanged.",
		"Otherwise return concise notes that capture what matters for future reasoning and the current active request.",
		"If the active request needs exact values and they are present in tool output, include those exact values explicitly.",
		"Do not include markdown fences.",
		"After your notes, append a brief line listing significant content sections present in the tool output that you did NOT capture above, prefixed with 'Also contains:'. Omit this line if everything significant is already captured.",
		"",
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
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, maxTokens: 1024 },
	);

	const text = response.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();

	if (!text) {
		return { passthrough: true, note: DISTILLER_SENTINEL };
	}
	if (text === DISTILLER_SENTINEL || text.includes(DISTILLER_SENTINEL)) {
		return { passthrough: true, note: text };
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
		if (event.isError) return;

		const fullText = serializeContent(event.content);
		if (fullText.length < MIN_LENGTH_FOR_IMPRESSION) return;

		const model = resolveModel(ctx.model);
		if (!model) {
			return {
				content: event.content,
			};
		}
		const apiKey = await ctx.modelRegistry.getApiKey(model);
		const visibleHistory = serializeVisibleHistory(buildSessionContext(ctx.sessionManager.getEntries()).messages);
		const originalSystemPrompt = ctx.getSystemPrompt();
		const distillation = await distillWithSameModel(
			model,
			apiKey,
			event.toolName,
			event.content,
			visibleHistory,
			originalSystemPrompt,
		);

		if (distillation.passthrough) {
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

			const activeModel = resolveModel(ctx.model);
			const model = resolveStoredModel(impression, activeModel);
			if (!model) {
				impression.recallCount = MAX_RECALL_BEFORE_PASSTHROUGH;
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				return createPassthroughToolResult(impression.fullContent);
			}

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			const visibleHistory = serializeVisibleHistory(buildSessionContext(ctx.sessionManager.getEntries()).messages);
			const originalSystemPrompt = ctx.getSystemPrompt();
			const distillation = await distillWithSameModel(
				model,
				apiKey,
				impression.toolName,
				impression.fullContent,
				visibleHistory,
				originalSystemPrompt,
			);

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
