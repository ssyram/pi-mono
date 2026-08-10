import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createStartWorkAgentSession } from "./start-work-agent-session.js";
import { resumeStartWorkSession } from "./start-work-resume.js";
import { runStartWorkStageOne } from "./start-work-stage-one.js";
import { runStartWorkStageTwo } from "./start-work-stage-two.js";
import {
	loadWorkPlan,
	loadWorkState,
	makeWorkPlanName,
	PLAN_DIR,
	saveWorkState,
	type WorkState,
} from "./start-work-state.js";

export function registerStartWorkCommand(pi: ExtensionAPI, _agentsDir: string): void {
	pi.registerCommand("omp-start", {
		description: "Start two-stage Prometheus + Momus workflow (use --resume to continue)",
		handler: async (args: string, context: ExtensionCommandContext) => {
			const isResume = args.includes("--resume");
			const task = args.replace("--resume", "").trim();
			const existingState = await loadWorkState(context.cwd);
			if (isResume) {
				if (!existingState?.activePlan) {
					context.ui.notify("[Error] No active design session to resume.", "error");
					return;
				}
				const safeName = existingState.activePlan.replace(`${PLAN_DIR}/`, "").replace(".md", "");
				await resumeStartWorkSession(context, existingState, safeName);
				return;
			}
			if (!task) {
				context.ui.notify("[Error] Task description required (or use --resume).", "error");
				return;
			}
			const safeName = makeWorkPlanName(task);
			if (await loadWorkPlan(context.cwd, safeName)) {
				context.ui.notify(`[Warning] Plan for "${task}" exists. Use --resume to continue.`, "warning");
				return;
			}
			const state: WorkState = {
				activePlan: `${PLAN_DIR}/${safeName}.md`,
				stage: "stage1",
				round: 0,
				gate1Rejections: 0,
				startedAt: Date.now(),
				lastUpdated: Date.now(),
			};
			await saveWorkState(context.cwd, state);
			context.ui.notify(`Starting two-stage workflow: ${task}`, "info");
			const session = await createStartWorkAgentSession(context, "prometheus");
			try {
				await session.prompt(
					`Task: ${task}\n\nYou are in Stage 1: Intent Confirmation Form.\n\n` +
						"Please generate the minimal YAML form capturing intent, design approach, components, and sanity check.",
					{ expandPromptTemplates: false },
				);
				await session.agent.waitForIdle();
				const { form, approved } = await runStartWorkStageOne(context, session, state, safeName);
				if (!approved) {
					context.ui.notify("[System] Stage 1 not approved. Use --resume to continue.", "warning");
					return;
				}
				state.stage = "stage2";
				state.round = 0;
				await saveWorkState(context.cwd, state);
				const { complete } = await runStartWorkStageTwo(context, session, state, safeName, form);
				if (complete) {
					context.ui.notify(`Design complete! Saved to ${PLAN_DIR}/${safeName}.md`, "info");
					await saveWorkState(context.cwd, {
						lastUpdated: Date.now(),
						stage: "stage1",
						round: 0,
						gate1Rejections: 0,
					});
				} else {
					context.ui.notify(
						`Session paused. Saved to ${PLAN_DIR}/${safeName}.md. Use --resume to continue.`,
						"info",
					);
				}
			} finally {
				session.dispose();
			}
		},
	});
}
