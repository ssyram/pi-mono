import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { buildCompactionContext } from "./compaction-conversation.js";
import {
	extractCompactionFileOperations,
	formatCompactionFileOperations,
} from "./compaction-file-operations.js";
import {
	buildCompactionPrompt,
	buildUpdateCompactionPrompt,
	COMPACTION_SYSTEM_PROMPT,
} from "./compaction-prompt.js";
import type { CompactionTaskStateReader } from "./compaction-task-context.js";

export { buildCompactionPrompt, buildUpdateCompactionPrompt } from "./compaction-prompt.js";

export function registerCustomCompaction(
	pi: ExtensionAPI,
	getTaskState: CompactionTaskStateReader,
): void {
	pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, context) => {
		const clearStatus = (): void => {
			try {
				context.ui.setStatus("omp-compact", undefined);
			} catch (error) {
				console.error(
					`[oh-my-pi compact] failed to clear status: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		};

		try {
			context.ui.setStatus("omp-compact", "⚡ Compacting (oh-my-pi)...");
			const model = context.model as Model<Api> | undefined;
			if (!model) {
				console.error("[oh-my-pi compact] ctx.model is undefined, falling back to built-in");
				clearStatus();
				return undefined;
			}

			const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				console.error(`[oh-my-pi compact] auth failed: ${auth.error}, falling back to built-in`);
				clearStatus();
				return undefined;
			}

			const preparation = event.preparation;
			const maxTokens = Math.floor(0.8 * preparation.settings.reserveTokens);
			const { conversationText, taskContext } = buildCompactionContext(
				preparation.messagesToSummarize,
				getTaskState,
				context,
				(messages) => serializeConversation(convertToLlm(messages)),
			);
			const prompt = preparation.previousSummary
				? buildUpdateCompactionPrompt(
						conversationText,
						preparation.previousSummary,
						taskContext,
						event.customInstructions,
					)
				: buildCompactionPrompt(conversationText, taskContext, event.customInstructions);
			const options: SimpleStreamOptions = {
				maxTokens,
				signal: event.signal,
				apiKey: auth.apiKey,
				headers: auth.headers,
			};
			if (model.reasoning) options.reasoning = "high";

			const response = await completeSimple(
				model,
				{
					systemPrompt: COMPACTION_SYSTEM_PROMPT,
					messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
				},
				options,
			);
			let summary = "";
			for (const block of response.content) {
				if (block.type === "text") summary += block.text;
			}
			if (!summary.trim()) {
				console.error("[oh-my-pi compact] LLM returned empty summary, falling back to built-in");
				clearStatus();
				return undefined;
			}

			summary += formatCompactionFileOperations(
				extractCompactionFileOperations(preparation.messagesToSummarize),
			);
			clearStatus();
			return {
				compaction: {
					summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
				},
			};
		} catch (error) {
			console.error("[oh-my-pi compact] error, falling back to built-in:", error);
			clearStatus();
			return undefined;
		}
	});
}
