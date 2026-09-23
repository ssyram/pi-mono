import { resolveUsageTargets } from "./command-targets.js";
import type { PiExtensionContext } from "./pi-extension-contract.js";
import { route } from "./route.js";
import { captureSelection } from "./selection.js";
import { executeUsageQuery } from "./usage-query.js";
import type { UsageModel } from "./usage-contract.js";

export async function queryUsageTarget(model: UsageModel, context: PiExtensionContext): Promise<string> {
	const name = model.provider;
	const selection = captureSelection(context, model);
	if (!selection) return `${name}: ERR`;
	const selectedRoute = route(selection);
	if (selectedRoute.kind === "unsupported") return `${name}: N/S`;
	if (selectedRoute.kind === "error") return `${name}: ERR`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	timeout.unref();
	try {
		const result = await executeUsageQuery(selection, selectedRoute, context.modelRegistry, controller.signal);
		if (controller.signal.aborted || result.kind === "cancelled") return `${name}: TIMEOUT`;
		if (result.kind === "available") return `${name}: ${result.text}`;
		if (result.kind === "not-applicable") return `${name}: 无适用套餐`;
		if (result.kind === "unsupported") return `${name}: N/S`;
		if (result.code === "auth") return `${name}: AUTH`;
		if (result.code === "timeout") return `${name}: TIMEOUT`;
		return `${name}: ERR`;
	} catch {
		return `${name}: ERR`;
	} finally {
		clearTimeout(timeout);
	}
}

export async function runUsageCommand(args: string, context: PiExtensionContext): Promise<void> {
	const target = resolveUsageTargets(args, context.model, context.modelRegistry);
	if (target.kind === "error") {
		context.ui.notify(target.message, "warning");
		return;
	}
	if (target.models.length === 0 && target.unknown.length === 0) {
		context.ui.notify("没有可用 provider", "info");
		return;
	}
	const lines: string[] = [];
	for (const model of target.models) lines.push(await queryUsageTarget(model, context));
	for (const name of target.unknown) lines.push(`${name}: 未找到 provider`);
	context.ui.notify(lines.join("\n"), "info");
}
