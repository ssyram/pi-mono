import type { AgentSession, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runMomusGateOneReview } from "./start-work-momus-review.js";
import { extractLastAssistantText, extractStageOneForm, isStageOneFormReady } from "./start-work-parsing.js";
import {
	MAX_GATE1_REJECTIONS,
	PLAN_DIR,
	saveWorkPlan,
	saveWorkState,
	type WorkState,
} from "./start-work-state.js";

export async function runStartWorkStageOne(
	context: ExtensionCommandContext,
	prometheusSession: AgentSession,
	state: WorkState,
	safeName: string,
): Promise<{ form: string; approved: boolean }> {
	context.ui.notify("=== Stage 1: Intent Confirmation Form ===", "info");
	let rejectionCount = 0;
	while (rejectionCount < MAX_GATE1_REJECTIONS) {
		const lastText = extractLastAssistantText(prometheusSession);
		if (!isStageOneFormReady(lastText)) {
			context.ui.notify("[Prometheus] Generating form...", "info");
			return { form: "", approved: false };
		}
		const form = extractStageOneForm(lastText);
		await saveWorkPlan(context.cwd, safeName, form);
		context.ui.notify(`[System] Form saved to ${PLAN_DIR}/${safeName}.md`, "info");
		context.ui.notify("[Momus Gate 1] Reviewing form...", "info");
		const { status, findings } = await runMomusGateOneReview(context, form);
		context.ui.notify(`[Momus Gate 1] Status: ${status}`, "info");
		if (status === "APPROVED" || status === "APPROVED_WITH_WARNINGS") {
			state.gate1Rejections = rejectionCount;
			await saveWorkState(context.cwd, state);
			return { form, approved: true };
		}
		rejectionCount += 1;
		state.gate1Rejections = rejectionCount;
		await saveWorkState(context.cwd, state);
		if (rejectionCount >= MAX_GATE1_REJECTIONS) {
			context.ui.notify(
				`[System] Max rejections (${MAX_GATE1_REJECTIONS}) reached. Manual review needed.`,
				"error",
			);
			return { form, approved: false };
		}
		await prometheusSession.prompt(
			`Momus Gate 1 has REJECTED your form. Please revise based on the following findings:\n\n` +
				`${findings}\n\nGenerate a revised form.`,
			{ expandPromptTemplates: false },
		);
		await prometheusSession.agent.waitForIdle();
	}
	return { form: "", approved: false };
}
