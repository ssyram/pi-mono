import { resolveUsageTargets } from "./command-targets.js";
import type { UsageQueryRunner } from "./controller-contract.js";
import type { PiExtensionContext } from "./pi-extension-contract.js";
import { route } from "./route.js";
import { captureSelection } from "./selection.js";
import type { UsageModel } from "./usage-contract.js";
import { executeUsageQuery } from "./usage-query.js";
import type { UsageQueryWidget } from "./usage-widget.js";
import type { UsageOutputEntryData } from "./usage-output-entry.js";

export interface UsageTargetReport {
	detail: string;
	pair: string;
	failed: boolean;
}

export async function queryUsageTarget(
	model: UsageModel,
	context: PiExtensionContext,
	query: UsageQueryRunner = (selection, route, registry, signal, readEntries) =>
		executeUsageQuery(selection, route, registry, signal, undefined, undefined, readEntries),
): Promise<UsageTargetReport> {
	const name = model.provider;
	const selection = captureSelection(context, model);
	if (!selection) return { detail: "query error", pair: `${name}:(ERR)`, failed: true };
	const selectedRoute = route(selection);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	timeout.unref();
	try {
		const result = await query(selection, selectedRoute, context.modelRegistry, controller.signal, () =>
			context.sessionManager.getEntries(),
		);
		if (controller.signal.aborted || result.kind === "cancelled") {
			return { detail: "query timeout", pair: `${name}:(TIMEOUT)`, failed: true };
		}
		if (result.kind === "available") return { detail: result.text, pair: `${name}:(${result.compact})`, failed: false };
		if (result.kind === "not-applicable") return { detail: "no applicable plan", pair: `${name}:(no plan)`, failed: false };
		if (result.kind === "unsupported") return { detail: "unsupported", pair: `${name}:(N/S)`, failed: false };
		if (result.code === "configuration") {
			return { detail: "glmTeams misconfigured (check global provider-usage.glmTeams)", pair: `${name}:(CONFIG)`, failed: true };
		}
		if (result.code === "auth") return { detail: "auth failed", pair: `${name}:(AUTH)`, failed: true };
		if (result.code === "timeout") return { detail: "query timeout", pair: `${name}:(TIMEOUT)`, failed: true };
		return { detail: "query error", pair: `${name}:(ERR)`, failed: true };
	} catch {
		return { detail: "query error", pair: `${name}:(ERR)`, failed: true };
	} finally {
		clearTimeout(timeout);
	}
}

function localTimestamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBlock(name: string, detail: string): string {
	const body = detail.trim() === "" ? "no data" : detail;
	return `${name}:\n${body.split("\n").map((line) => `  ${line}`).join("\n")}`;
}

export async function runUsageCommand(
	args: string,
	context: PiExtensionContext,
	query: UsageQueryRunner = (selection, route, registry, signal, readEntries) =>
		executeUsageQuery(selection, route, registry, signal, undefined, undefined, readEntries),
	widget?: UsageQueryWidget,
	appendOutput: (data: UsageOutputEntryData) => void = () => {},
	sendToAi: (content: string, details: { collapsed: string }) => void = () => {},
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
	const blocks: string[] = [];
	const pairs: string[] = [];
	let failed = false;
	widget?.begin("Querying provider usage…");
	try {
		for (const model of target.models) {
			const result = await queryUsageTarget(model, context, query);
			blocks.push(formatBlock(model.provider, result.detail));
			pairs.push(result.pair);
			failed = failed || result.failed;
		}
	} finally {
		widget?.end();
	}
	const unknownBlocks = target.unknown.map((name) => formatBlock(name, "provider not found"));
	const text = ["Provider usage · " + localTimestamp(new Date()), ...blocks, ...unknownBlocks].join("\n\n");
	if (target.showToAi) {
		sendToAi(text, { collapsed: pairs.join(", ") });
		return;
	}
	appendOutput({ tone: failed ? "warning" : "info", text });
}
