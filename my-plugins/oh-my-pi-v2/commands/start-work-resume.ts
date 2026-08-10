import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createStartWorkAgentSession } from "./start-work-agent-session.js";
import { runStartWorkStageOne } from "./start-work-stage-one.js";
import { runStartWorkStageTwo } from "./start-work-stage-two.js";
import {
	loadWorkPlan,
	PLAN_DIR,
	saveWorkState,
	type WorkState,
} from "./start-work-state.js";

export async function resumeStartWorkSession(
	context: ExtensionCommandContext,
	state: WorkState,
	safeName: string,
): Promise<void> {
	context.ui.notify("=== Resume Mode: Continuing design session ===", "info");
	const existingPlan = await loadWorkPlan(context.cwd, safeName);
	if (!existingPlan) {
		context.ui.notify(`[Error] No plan found for "${safeName}".`, "error");
		return;
	}
	context.ui.notify(`[System] Loaded plan from ${PLAN_DIR}/${safeName}.md`, "info");
	context.ui.notify(`[System] Stage: ${state.stage}, Round: ${state.round}`, "info");
	const session = await createStartWorkAgentSession(context, "prometheus");
	try {
		if (state.stage === "stage1") {
			await session.prompt(
				`Resuming Stage 1 design session.\n\n` +
					`Existing form:\n\`\`\`yaml\n${existingPlan}\n\`\`\`\n\n` +
					"This form was previously rejected by Momus Gate 1. Please revise it based on user feedback.",
				{ expandPromptTemplates: false },
			);
			await session.agent.waitForIdle();
			const { form, approved } = await runStartWorkStageOne(context, session, state, safeName);
			if (approved) {
				state.stage = "stage2";
				state.round = 0;
				await saveWorkState(context.cwd, state);
				await runStartWorkStageTwo(context, session, state, safeName, form);
			}
		} else {
			await session.prompt(
				`Resuming Stage 2 design session.\n\n` +
					`Existing design document:\n\`\`\`markdown\n${existingPlan}\n\`\`\`\n\n` +
					"Please continue expanding the design or declare completion if ready.",
				{ expandPromptTemplates: false },
			);
			await session.agent.waitForIdle();
			await runStartWorkStageTwo(context, session, state, safeName, "");
		}
	} finally {
		session.dispose();
	}
}
