/**
 * AI-callable provider usage query: same pipeline as /provider-usage,
 * per-provider lines returned as tool text. Omitting `provider` queries all.
 */
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SHOW_TO_AI_FLAG } from "./command-targets.ts";
import type { UsageQueryRunner } from "./controller-contract.ts";
import type { PiExtensionContext } from "./pi-extension-contract.ts";
import { runUsageCommand } from "./usage-command.ts";

const parameters = Type.Object({
	provider: Type.Optional(
		Type.String({ description: "Specific provider id. Omit to query all providers (recommended)." }),
	),
});

export function registerUsageTool(
	pi: object,
	createQuery: (context: PiExtensionContext) => UsageQueryRunner,
): void {
	// The narrow contract declares registerTool loosely; the host's typed signature comes from ExtensionAPI.
	(pi as ExtensionAPI).registerTool({
		name: "provider_usage",
		label: "Provider Usage",
		description:
			"Query remaining quota/usage for providers. Returns one block per provider (name header, indented detail lines), sorted by name. Omit `provider` to query all (recommended); pass a provider id only when a single provider is needed.",
		promptSnippet: "provider_usage: query provider quota/usage; all providers sorted by name, one block each.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			// params.provider is model-controlled text; the UI flag would route output to the no-op sendToAi path.
			const raw = params.provider?.trim() ? params.provider : "--all";
			const args = raw
				.split(/\s+/)
				.filter((token) => token !== SHOW_TO_AI_FLAG)
				.join(" ");
			const lines: string[] = [];
			await runUsageCommand(args, ctx, createQuery(ctx), undefined, (data) => {
				lines.push(data.text);
			});
			return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
		},
	});
}
