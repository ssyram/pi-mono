import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerConsult } from "./commands/consult.js";
import { registerReviewPlan } from "./commands/review-plan.js";
import { registerStartWorkCommand } from "./commands/start-work.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerUltrawork } from "./commands/ultrawork.js";
import { loadConfig } from "./config.js";
import { registerBoulder } from "./hooks/boulder.js";
import { registerCommentChecker } from "./hooks/comment-checker.js";
import { registerCustomCompaction } from "./hooks/custom-compaction.js";
import { registerEditErrorRecovery } from "./hooks/edit-error-recovery.js";
import { registerRulesInjector } from "./hooks/rules-injector.js";
import { registerSisyphusPrompt } from "./hooks/sisyphus-prompt.js";
import { registerTaskGate } from "./hooks/task-gate.js";
import { registerToolOutputTruncator } from "./hooks/tool-output-truncator.js";
import { registerUltraworkPrompt } from "./hooks/ultrawork-prompt.js";
import { ensureSubagentIntegration } from "./subagent-links.js";
import { TaskWidgetComponent } from "./tools/task-display.js";
import { isUnblocked } from "./tools/task-dependencies.js";
import type { Task } from "./tools/task-types.js";
import { isTaskWidgetVisible } from "./tools/task-widget-state.js";
import { registerTaskTool } from "./tools/task.js";

function renderTaskWidget(
	context: ExtensionContext,
	tasks: Task[],
	visible = isTaskWidgetVisible(context.sessionManager),
	notifyWhenComplete = false,
): void {
	if (!visible || tasks.length === 0) {
		context.ui.setWidget("omp-tasks", undefined);
		return;
	}
	const hasActive = tasks.some(
		(task) => task.status === "in_progress" || (task.status === "pending" && isUnblocked(task, tasks)),
	);
	if (!hasActive) {
		if (notifyWhenComplete) {
			const done = tasks.filter((task) => task.status === "done").length;
			const expired = tasks.filter((task) => task.status === "expired").length;
			const blocked = tasks.filter((task) => task.status === "pending").length;
			const parts: string[] = [];
			if (done > 0) parts.push(`✓ ${done} done`);
			if (expired > 0) parts.push(`✗ ${expired} expired`);
			if (blocked > 0) parts.push(`○ ${blocked} blocked`);
			context.ui.notify(`Tasks complete: ${parts.join(", ")}`, "info");
		}
		context.ui.setWidget("omp-tasks", undefined);
		return;
	}
	context.ui.setWidget("omp-tasks", () => new TaskWidgetComponent(tasks));
}

export default async function ohMyPiV2(pi: ExtensionAPI): Promise<void> {
	const directory = dirname(fileURLToPath(import.meta.url));
	const agentsDirectory = resolve(directory, "agents");
	await ensureSubagentIntegration(directory, agentsDirectory, process.cwd());

	let config: Awaited<ReturnType<typeof loadConfig>>;
	try {
		config = await loadConfig(process.cwd());
	} catch (error) {
		console.error(
			`[oh-my-pi] Failed to load config, using defaults: ${error instanceof Error ? error.message : error}`,
		);
		config = {};
	}

	const { getTaskState, setOnTaskChange, runHumanTaskCommand } = registerTaskTool(pi);
	setOnTaskChange((tasks, context) => {
		try {
			renderTaskWidget(context, tasks, undefined, true);
		} catch (error) {
			console.error(
				`[oh-my-pi task] Widget update failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});

	registerTaskGate(pi, getTaskState);

	if (config.boulder_enabled !== false) registerBoulder(pi, getTaskState);
	registerSisyphusPrompt(pi, config, agentsDirectory);
	registerUltraworkPrompt(pi);
	registerCommentChecker(pi);
	registerCustomCompaction(pi, getTaskState);
	registerRulesInjector(pi, config);
	registerEditErrorRecovery(pi);
	registerToolOutputTruncator(pi);
	registerStartWorkCommand(pi, agentsDirectory);
	registerConsult(pi, agentsDirectory);
	registerReviewPlan(pi, agentsDirectory);
	registerUltrawork(pi);
	registerTaskCommand(pi, {
		getTasks: (context) => getTaskState(context).tasks,
		setWidgetVisibility: (context, visible) => renderTaskWidget(context, getTaskState(context).tasks, visible),
		runHumanTaskCommand,
	});

	pi.on("session_start", async (_event, context) => {
		renderTaskWidget(context, getTaskState(context).tasks);
	});
	pi.on("session_tree", async (_event, context) => {
		renderTaskWidget(context, getTaskState(context).tasks);
	});
	pi.on("resources_discover", () => ({ skillPaths: [resolve(directory, "skills")] }));
	pi.on("session_shutdown", async (_event, context) => {
		try {
			context.ui.setWidget("omp-tasks", undefined);
		} catch (error) {
			console.error(
				`[oh-my-pi task] Widget shutdown cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}
