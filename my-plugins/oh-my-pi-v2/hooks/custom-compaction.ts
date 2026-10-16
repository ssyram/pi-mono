import type { Api, Model } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";
import { COMPACTION_SYSTEM_PROMPT } from "./compaction-prompt.js";
import type { CompactionTaskStateReader } from "./compaction-task-context.js";
import { prepareCompactionRequest } from "./prepare-compaction-request.js";

export {
	buildCompactionPrompt,
	buildUpdateCompactionPrompt,
} from "./compaction-prompt.js";

export function registerCustomCompaction(
	pi: ExtensionAPI,
	getTaskState: CompactionTaskStateReader,
): void {
	pi.on(
		"session_before_compact",
		async (event: SessionBeforeCompactEvent, context) => {
			const clearStatus = (): void => {
				try {
					context.ui.setStatus("omp-compact", undefined);
				} catch (error) {
					reportBoulderDiagnostic(
						`[oh-my-pi compact] failed to clear status: ${describeThrown(error)}`,
					);
				}
			};

			try {
				context.ui.setStatus("omp-compact", "⚡ Compacting (oh-my-pi)...");
				const model = context.model as Model<Api> | undefined;
				if (!model) {
					reportBoulderDiagnostic(
						"[oh-my-pi compact] ctx.model is undefined, falling back to built-in",
					);
					clearStatus();
					return undefined;
				}

				const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) {
					reportBoulderDiagnostic(
						`[oh-my-pi compact] auth failed: ${auth.error}, falling back to built-in`,
					);
					clearStatus();
					return undefined;
				}

				const preparation = event.preparation;
				const request = prepareCompactionRequest(event, context, getTaskState);
				const { prompt, maxTokens } = request;
				const options: NonNullable<Parameters<typeof completeSimple>[2]> = {
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
						messages: [
							{ role: "user", content: prompt, timestamp: Date.now() },
						],
					},
					options,
				);
				let summary = "";
				for (const block of response.content) {
					if (block.type === "text") summary += block.text;
				}
				summary = request.finalizeSummary(summary);
				if (!summary.trim()) {
					reportBoulderDiagnostic(
						"[oh-my-pi compact] LLM returned empty summary, falling back to built-in",
					);
					clearStatus();
					return undefined;
				}

				clearStatus();
				return {
					compaction: {
						summary,
						firstKeptEntryId: preparation.firstKeptEntryId,
						tokensBefore: preparation.tokensBefore,
					},
				};
			} catch (error) {
				reportBoulderDiagnostic(
					`[oh-my-pi compact] error, falling back to built-in: ${describeThrown(error)}`,
				);
				clearStatus();
				return undefined;
			}
		},
	);
}
