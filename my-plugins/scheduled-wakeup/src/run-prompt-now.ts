import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { LoopV2Runtime } from "./loop-command-handler.js";
import { notifyLoop } from "./loop-notification.js";

export function runPromptNow(
	pi: ExtensionAPI,
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
	let prompt: string | undefined;
	if (active?.kind === "session") prompt = active.task.definition.prompt;
	if (active?.kind === "registration" && active.definition !== undefined)
		prompt = active.definition.prompt;
	if (active === undefined || prompt === undefined) {
		notifyLoop(ctx, `No runnable active task ${id}.`, "warning");
		return;
	}
	try {
		if (ctx.isIdle()) pi.sendUserMessage(prompt);
		else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	} catch (error) {
		notifyLoop(ctx, `Delivery of ${id} failed: ${String(error)}`, "error");
		return;
	}
	notifyLoop(ctx, `Delivered ${id}.`, "info");
}
