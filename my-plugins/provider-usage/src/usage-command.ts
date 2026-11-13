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
): Promise<{ line: string; pair: string }> {
	const name = model.provider;
	const selection = captureSelection(context, model);
	if (!selection) return { line: `${name}: ERR`, pair: `${name}:(ERR)` };
	const selectedRoute = route(selection);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	timeout.unref();
	try {
		const result = await query(selection, selectedRoute, context.modelRegistry, controller.signal, () =>
			context.sessionManager.getEntries(),
		);
		if (controller.signal.aborted || result.kind === "cancelled") return { line: `${name}: TIMEOUT`, pair: `${name}:(TIMEOUT)` };
		if (result.kind === "available") return { line: `${name}: ${result.text}`, pair: `${name}:(${result.compact})` };
		if (result.kind === "not-applicable") return { line: `${name}: no applicable plan`, pair: `${name}:(no plan)` };
		if (result.kind === "unsupported") return { line: `${name}: N/S`, pair: `${name}:(N/S)` };
		if (result.code === "configuration") {
			return { line: `${name}: CONFIG (check global provider-usage.glmTeams)`, pair: `${name}:(CONFIG)` };
		}
		if (result.code === "auth") return { line: `${name}: AUTH`, pair: `${name}:(AUTH)` };
		if (result.code === "timeout") return { line: `${name}: TIMEOUT`, pair: `${name}:(TIMEOUT)` };
		return { line: `${name}: ERR`, pair: `${name}:(ERR)` };
	} catch {
		return { line: `${name}: ERR`, pair: `${name}:(ERR)` };
	} finally {
		clearTimeout(timeout);
	}
}

const AI_ERROR_LEGEND =
	"Codes: AUTH=authentication failed, TIMEOUT=query timeout, CONFIG=provider-usage.glmTeams misconfigured, N/S=unsupported, ERR=query error.";

function localTimestamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
	const lines: string[] = [];
	const pairs: string[] = [];
	widget?.begin("Querying provider usage…");
	try {
		for (const model of target.models) {
			const result = await queryUsageTarget(model, context, query);
			lines.push(result.line);
			pairs.push(result.pair);
		}
	} finally {
		widget?.end();
	}
	const unknownLines = target.unknown.map((name) => `${name}: provider not found`);
	const failed = lines.some((line) => /\b(ERR|AUTH|TIMEOUT|CONFIG)\b/.test(line));
	if (target.showToAi) {
		const header = `Provider usage snapshot (/provider-usage --show-to-ai, ${localTimestamp(new Date())}):`;
		const content = [header, ...lines, ...(failed ? [AI_ERROR_LEGEND] : [])].join("\n");
		sendToAi(content, { collapsed: pairs.join(", ") });
		return;
	}
	appendOutput({ tone: failed ? "warning" : "info", text: [...lines, ...unknownLines].join("\n") });
}
