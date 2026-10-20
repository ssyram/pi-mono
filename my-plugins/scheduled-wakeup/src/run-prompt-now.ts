import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { LoopV2Runtime } from "./loop-command-handler.js";
import { loopErrorMessage } from "./loop-error-message.js";
import { notifyLoop } from "./loop-notification.js";
import { cloneTaskContent } from "./v2/task-content.js";

export function runPromptNow(
	_pi: ExtensionAPI,
	rt: LoopV2Runtime,
	id: string,
	ctx: ExtensionCommandContext,
): void {
	const active = rt.core
		.listActive()
		.find(
			(item) =>
				(item.kind === "session"
					? item.task.definition.id
					: item.registration.id) === id,
		);
	const definition =
		active?.kind === "session" ? active.task.definition : active?.definition;
	if (!definition) {
		notifyLoop(ctx, `No runnable active task ${id}.`, "warning");
		return;
	}
	try {
		rt.dispatcher.dispatch({
			id,
			scope: definition.scope,
			...cloneTaskContent(definition),
		});
	} catch (error) {
		notifyLoop(
			ctx,
			`Delivery of ${id} failed: ${loopErrorMessage(error)}`,
			"error",
		);
		return;
	}
	notifyLoop(ctx, `Started ${id}.`, "info");
}
