import {
	convertToLlm,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import {
	renderCompactionReferenceSummary,
	serializeCompactionReferenceConversation,
} from "./annotate-compaction-references.js";
import { filterBoulderResumeMessages } from "./boulder-resume-message.js";
import {
	extractCompactionFileOperations,
	formatCompactionFileOperations,
} from "./compaction-file-operations.js";
import {
	buildCompactionPrompt,
	buildUpdateCompactionPrompt,
} from "./compaction-prompt.js";
import {
	escapeCompactionReferenceLiterals,
	expandCompactionReferences,
} from "./compaction-reference-codec.js";
import { buildCompactionReferenceInstructions } from "./compaction-reference-prompt.js";
import { buildCompactionReferenceState } from "./compaction-reference-state.js";
import {
	type CompactionTaskStateReader,
	formatCompactionTaskContext,
} from "./compaction-task-context.js";

export interface PreparedCompactionRequest {
	readonly prompt: string;
	readonly maxTokens: number;
	finalizeSummary(draft: string): string;
}

export function prepareCompactionRequest(
	event: Pick<SessionBeforeCompactEvent, "preparation" | "customInstructions">,
	context: ExtensionContext,
	getTaskState: CompactionTaskStateReader,
): PreparedCompactionRequest {
	const { preparation, customInstructions } = event;
	const messages = filterBoulderResumeMessages(
		preparation.messagesToSummarize,
		undefined,
	);
	const taskContext = formatCompactionTaskContext(getTaskState, context);
	const maxTokens = Math.floor(0.8 * preparation.settings.reserveTokens);
	const state = buildCompactionReferenceState(
		messages,
		preparation.previousSummary,
	);
	const fileSuffix = formatCompactionFileOperations(
		extractCompactionFileOperations(preparation.messagesToSummarize),
	);
	const referencesEnabled = state.sources.length > 0;
	let prompt: string;
	if (referencesEnabled) {
		const annotated = serializeCompactionReferenceConversation(
			messages,
			state,
			(items) => serializeConversation(convertToLlm(items)),
		);
		const escapedTasks = escapeCompactionReferenceLiterals(taskContext);
		const escapedInstructions =
			customInstructions === undefined
				? undefined
				: escapeCompactionReferenceLiterals(customInstructions);
		prompt =
			(preparation.previousSummary
				? buildUpdateCompactionPrompt(
						annotated,
						renderCompactionReferenceSummary(state),
						escapedTasks,
						escapedInstructions,
					)
				: buildCompactionPrompt(annotated, escapedTasks, escapedInstructions)) +
			`\n\n${buildCompactionReferenceInstructions()}`;
	} else {
		const conversation = serializeConversation(convertToLlm(messages));
		prompt = preparation.previousSummary
			? buildUpdateCompactionPrompt(
					conversation,
					preparation.previousSummary,
					taskContext,
					customInstructions,
				)
			: buildCompactionPrompt(conversation, taskContext, customInstructions);
	}
	return Object.freeze({
		prompt,
		maxTokens,
		finalizeSummary(draft: string): string {
			const body = referencesEnabled
				? expandCompactionReferences(state, draft)
				: draft;
			if (!body.trim()) return "";
			return body + fileSuffix;
		},
	});
}
