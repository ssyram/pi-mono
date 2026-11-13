import { resolveUsageTargets } from "./command-targets.js";
import type { UsageQueryRunner } from "./controller-contract.js";
import type { PiExtensionContext } from "./pi-extension-contract.js";
import { route } from "./route.js";
import { captureSelection } from "./selection.js";
import type { UsageModel } from "./usage-contract.js";
import { executeUsageQuery } from "./usage-query.js";
import type { UsageQueryWidget } from "./usage-widget.js";
import type { UsageOutputEntryData } from "./usage-output-entry.js";

export async function queryUsageTarget(
	model: UsageModel,
	context: PiExtensionContext,
	query: UsageQueryRunner = (selection, route, registry, signal, readEntries) =>
		executeUsageQuery(selection, route, registry, signal, undefined, undefined, readEntries),
): Promise<string> {
	const name = model.provider;
	const selection = captureSelection(context, model);
	if (!selection) return `${name}: ERR`;
	const selectedRoute = route(selection);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	timeout.unref();
	try {
		const result = await query(selection, selectedRoute, context.modelRegistry, controller.signal, () =>
			context.sessionManager.getEntries(),
		);
		if (controller.signal.aborted || result.kind === "cancelled") return `${name}: TIMEOUT`;
		if (result.kind === "available") return `${name}: ${result.text}`;
		if (result.kind === "not-applicable") return `${name}: no applicable plan`;
		if (result.kind === "unsupported") return `${name}: N/S`;
		if (result.code === "configuration") return `${name}: CONFIG (check global provider-usage.glmTeams)`;
		if (result.code === "auth") return `${name}: AUTH`;
		if (result.code === "timeout") return `${name}: TIMEOUT`;
		return `${name}: ERR`;
	} catch {
		return `${name}: ERR`;
	} finally {
		clearTimeout(timeout);
	}
}

export async function runUsageCommand(
	args: string,
	context: PiExtensionContext,
	query: UsageQueryRunner = (selection, route, registry, signal, readEntries) =>
		executeUsageQuery(selection, route, registry, signal, undefined, undefined, readEntries),
	widget?: UsageQueryWidget,
	appendOutput: (data: UsageOutputEntryData) => void = () => {},
): Promise<void> {
	const target = resolveUsageTargets(args, context.model, context.modelRegistry);
	if (target.kind === "error") {
		appendOutput({ tone: "warning", text: target.message });
		return;
	}
	if (target.models.length === 0 && target.unknown.length === 0) {
		appendOutput({ tone: "info", text: "no providers available" });
		return;
	}
	const lines: string[] = [];
	widget?.begin("Querying provider usage…");
	try {
		for (const model of target.models) lines.push(await queryUsageTarget(model, context, query));
	} finally {
		widget?.end();
	}
	for (const name of target.unknown) lines.push(`${name}: provider not found`);
	const failed = lines.some((line) => /\b(ERR|AUTH|TIMEOUT|CONFIG)\b/.test(line));
	appendOutput({ tone: failed ? "warning" : "info", text: lines.join("\n") });
}
