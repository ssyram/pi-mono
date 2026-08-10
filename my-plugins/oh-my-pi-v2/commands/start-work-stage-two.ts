import type { AgentSession, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runMomusCollaborativeReview, runMomusFinalReview } from "./start-work-momus-review.js";
import {
	extractLastAssistantText,
	extractStageTwoDocument,
	isStageTwoDocumentReady,
	prometheusDeclaresComplete,
} from "./start-work-parsing.js";
import {
	MAX_STAGE2_ROUNDS,
	saveWorkPlan,
	saveWorkState,
	type WorkState,
} from "./start-work-state.js";

export async function runStartWorkStageTwo(
	context: ExtensionCommandContext,
	prometheusSession: AgentSession,
	state: WorkState,
	safeName: string,
	initialForm: string,
): Promise<{ doc: string; complete: boolean }> {
	context.ui.notify("=== Stage 2: Design Document Collaboration ===", "info");
	await prometheusSession.prompt(
		`Stage 1 form has been approved. Please convert it to the Stage 2 Markdown design document template.\n\n` +
			`Stage 1 Form:\n\`\`\`yaml\n${initialForm}\n\`\`\`\n\n` +
			"Generate the initial Stage 2 design document.",
		{ expandPromptTemplates: false },
	);
	await prometheusSession.agent.waitForIdle();
	let round = state.round;
	while (round < MAX_STAGE2_ROUNDS) {
		const lastText = extractLastAssistantText(prometheusSession);
		if (!isStageTwoDocumentReady(lastText)) {
			context.ui.notify("[Prometheus] Generating design document...", "info");
			return { doc: "", complete: false };
		}
		const document = extractStageTwoDocument(lastText);
		await saveWorkPlan(context.cwd, safeName, document);
		context.ui.notify(`[System] Document saved (Round ${round + 1})`, "info");
		if (prometheusDeclaresComplete(lastText)) {
			context.ui.notify("[Prometheus] Declares: No pending decision points.", "info");
			const review = await runMomusFinalReview(context, document);
			context.ui.notify(`[Momus Final Self-Review] Recommendation: ${review.action}`, "info");
			const finalDocument = `${document}\n\n---\n\n${review.text}`;
			await saveWorkPlan(context.cwd, safeName, finalDocument);
			if (review.action === "END") return { doc: finalDocument, complete: true };
			await prometheusSession.prompt(
				`Momus Final Self-Review recommends: ${review.action}\n\n` +
					`Rationale: ${review.rationale}\n\n` +
					"Please address the recommendations and continue expanding the design.",
				{ expandPromptTemplates: false },
			);
			await prometheusSession.agent.waitForIdle();
			round += 1;
			state.round = round;
			await saveWorkState(context.cwd, state);
			continue;
		}
		const momusText = await runMomusCollaborativeReview(context, document);
		await saveWorkPlan(context.cwd, safeName, `${document}\n\n---\n\n${momusText}`);
		context.ui.notify(`[Momus] Review appended (Round ${round + 1})`, "info");
		const userInput = await context.ui.input(
			"Round complete. Provide feedback, type 'continue', or 'done': ",
			"continue",
		);
		if (!userInput || userInput.toLowerCase() === "done") {
			context.ui.notify("[System] Session ended by user.", "info");
			return {
				doc: extractStageTwoDocument(extractLastAssistantText(prometheusSession)),
				complete: false,
			};
		}
		if (userInput.toLowerCase() === "continue") {
			await prometheusSession.prompt(
				"Momus has reviewed the design. Please continue expanding or declare completion if ready.",
				{ expandPromptTemplates: false },
			);
		} else {
			await prometheusSession.prompt(
				`User feedback:\n${userInput}\n\nPlease incorporate this feedback and update the design document.`,
				{ expandPromptTemplates: false },
			);
		}
		await prometheusSession.agent.waitForIdle();
		round += 1;
		state.round = round;
		await saveWorkState(context.cwd, state);
	}
	context.ui.notify(`[System] Max rounds (${MAX_STAGE2_ROUNDS}) reached.`, "warning");
	const lastText = extractLastAssistantText(prometheusSession);
	return {
		doc: isStageTwoDocumentReady(lastText) ? extractStageTwoDocument(lastText) : lastText,
		complete: false,
	};
}
