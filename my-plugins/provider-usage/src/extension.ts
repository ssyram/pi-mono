import { completeProviderUsageArgs, createProviderUsageCompletion } from "./command-completion.js";
import { createController } from "./create-controller.js";
import type { ControllerContext } from "./controller-contract.js";
import type { UsageController } from "./usage-controller.js";
import type { PiExtensionAPI, PiExtensionContext } from "./pi-extension-contract.js";
import { runUsageCommand } from "./usage-command.js";
import type { UsageModelRegistry } from "./usage-contract.js";

function controllerContext(context: PiExtensionContext): ControllerContext {
	return {
		sessionManager: context.sessionManager,
		modelRegistry: context.modelRegistry,
		getContextUsage: () => context.getContextUsage(),
		setFooter: (factory) => context.ui.setFooter(factory),
	};
}

export default function register(pi: PiExtensionAPI): void {
	let controller: UsageController | undefined;
	let commandRegistry: UsageModelRegistry | undefined;
	pi.registerCommand("provider-usage", {
		description: "Query the current provider, --all, or named providers; Tab completes provider names",
		getArgumentCompletions: (prefix) =>
			commandRegistry ? completeProviderUsageArgs(prefix, commandRegistry, controller?.getFooterSnapshot().model) : null,
		handler: runUsageCommand,
	});
	pi.on("session_start", (_event, context) => {
		controller?.dispose();
		controller = undefined;
		commandRegistry = context.modelRegistry;
		if (context.mode !== "tui") return;
		controller = createController(controllerContext(context), context.model);
		if (context.thinkingLevel) controller.updateThinkingLevel(context.thinkingLevel);
		context.ui.addAutocompleteProvider((current) =>
			createProviderUsageCompletion(current, () => ({
				registry: context.modelRegistry,
				model: controller?.getFooterSnapshot().model ?? context.model,
			})),
		);
	});
	pi.on("model_select", (event, context) => {
		if (context.thinkingLevel) controller?.updateThinkingLevel(context.thinkingLevel);
		if (event.model) controller?.requestRefresh(event.model, true);
	});
	pi.on("thinking_level_select", (event) => {
		if (event.level) controller?.updateThinkingLevel(event.level);
	});
	pi.on("turn_end", (_event, context) => {
		if (context.thinkingLevel) controller?.updateThinkingLevel(context.thinkingLevel);
		controller?.requestRefresh(context.model);
	});
	pi.on("session_shutdown", () => {
		controller?.dispose();
		controller = undefined;
		commandRegistry = undefined;
	});
}
