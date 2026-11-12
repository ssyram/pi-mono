import { completeProviderUsageArgs, createProviderUsageCompletion } from "./command-completion.js";
import type { ControllerContext, UsageQueryRunner } from "./controller-contract.js";
import { createController } from "./create-controller.js";
import type { PiExtensionAPI, PiExtensionContext } from "./pi-extension-contract.js";
import { runUsageCommand } from "./usage-command.js";
import type { UsageModelRegistry } from "./usage-contract.js";
import type { UsageController } from "./usage-controller.js";
import { registerUsageOutputEntryRenderer, USAGE_OUTPUT_ENTRY_TYPE, type UsageOutputEntryData } from "./usage-output-entry.js";
import { createUsageQueryWidget, type UsageQueryWidget } from "./usage-widget.js";
import { executeUsageQuery } from "./usage-query.js";
import { registerUsageTool } from "./usage-tool.js";

function defaultQueryRunner(): UsageQueryRunner {
	return (selection, route, registry, signal, readEntries) =>
		executeUsageQuery(selection, route, registry, signal, undefined, readEntries);
}

function controllerContext(
	context: PiExtensionContext,
	query: UsageQueryRunner,
	widget?: UsageQueryWidget,
): ControllerContext {
	return {
		sessionManager: context.sessionManager,
		modelRegistry: context.modelRegistry,
		query,
		queryWidget: widget,
		getContextUsage: () => context.getContextUsage(),
		setFooter: (factory) => context.ui.setFooter(factory),
	};
}

export default function register(
	pi: PiExtensionAPI,
	createQuery: (context: PiExtensionContext) => UsageQueryRunner = () => defaultQueryRunner(),
): void {
	let controller: UsageController | undefined;
	let commandRegistry: UsageModelRegistry | undefined;
	let queryWidget: UsageQueryWidget | undefined;
	registerUsageOutputEntryRenderer(pi);
	registerUsageTool(pi, createQuery);
	pi.registerCommand("provider-usage", {
		description: "Query the current provider, --all, or named providers; Tab completes provider names",
		getArgumentCompletions: (prefix) =>
			commandRegistry
				? completeProviderUsageArgs(prefix, commandRegistry, controller?.getFooterSnapshot().model)
				: null,
		handler: (args, context) =>
			runUsageCommand(args, context, createQuery(context), queryWidget, (data: UsageOutputEntryData) =>
				pi.appendEntry(USAGE_OUTPUT_ENTRY_TYPE, data)),
	});
	pi.on("session_start", (_event, context) => {
		controller?.dispose();
		controller = undefined;
		commandRegistry = context.modelRegistry;
		if (context.mode !== "tui") return;
		queryWidget = createUsageQueryWidget((key, content) => context.ui.setWidget(key, content));
		controller = createController(controllerContext(context, createQuery(context), queryWidget), context.model);
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
		queryWidget = undefined;
	});
}
