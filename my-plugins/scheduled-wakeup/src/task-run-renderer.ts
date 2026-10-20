import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, MouseRegion, Text } from "@earendil-works/pi-tui";
import { renderTaskRun } from "./script-tasks/render-task-run.js";
import type { TaskRun } from "./script-tasks/task-spec.js";
import { TASK_RUN_MESSAGE } from "./task-dispatcher.js";

export function registerTaskRunRenderer(pi: ExtensionAPI): void {
	const views = new WeakMap<
		object,
		{ expanded: boolean; globalExpanded: boolean }
	>();
	pi.registerMessageRenderer<TaskRun>(
		TASK_RUN_MESSAGE,
		(message, { expanded, outputPad }, theme) => {
			try {
				if (!message.details) return undefined;
				const box = new Box(outputPad, 1, (text) =>
					theme.bg("customMessageBg", text),
				);
				const previous = views.get(message);
				const state =
					previous?.globalExpanded === expanded
						? previous
						: { expanded, globalExpanded: expanded };
				views.set(message, state);
				const body = new Text(message.details.content, 0, 0);
				const title = new MouseRegion(
					new Text(renderTaskRun(message.details, false), 0, 0),
					(event) => {
						if (event.type !== "click" || event.button !== "left")
							return undefined;
						try {
							state.expanded = !state.expanded;
							refresh();
							return { handled: true };
						} catch {
							return { handled: true, render: false };
						}
					},
				);
				const refresh = (): void => {
					box.clear();
					box.addChild(title);
					if (state.expanded) box.addChild(body);
				};
				refresh();
				return box;
			} catch {
				return undefined;
			}
		},
	);
}
