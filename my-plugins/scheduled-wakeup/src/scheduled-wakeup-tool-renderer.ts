/**
 * TUI rendering for scheduled_wakeup results: list results collapse to the
 * static loop-widget summary line and expand to the model-facing list text;
 * other results render their message text.
 */
import type {
	AgentToolResult,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { AiSessionActionResult } from "./v2/ai-session-actions.js";

export function registerScheduledWakeupToolRenderer(pi: ExtensionAPI): void {
	pi.registerToolRenderer((toolName, next) => {
		if (toolName !== "scheduled_wakeup") return next();
		// The resolver chain's base is withBuiltInRenderers(...), always non-null;
		// claim renderResult explicitly instead of relying on next() ?? own.
		return {
			...next(),
			renderResult: (result, options, theme, context) => {
				const details = result.details as AiSessionActionResult | undefined;
				// ToolRenderers widens args to {}; this resolver only serves scheduled_wakeup.
				const args = context.args as { action?: string } | undefined;
				const output = resultText(result);
				const container = new Container();
				container.addChild(new Spacer(1));
				if (
					args?.action === "list" &&
					details?.ok === true &&
					Array.isArray(details.active)
				) {
					const summary = `${details.active.length} scheduled`;
					container.addChild(new Text(theme.fg("toolOutput", summary), 0, 0));
					if (options.expanded && output !== "")
						container.addChild(new Text(theme.fg("toolOutput", output), 0, 0));
					return container;
				}
				if (output !== "")
					container.addChild(
						new Text(
							theme.fg(result.isError ? "error" : "toolOutput", output),
							0,
							0,
						),
					);
				return container;
			},
		};
	});
}

function resultText(result: AgentToolResult<AiSessionActionResult>): string {
	return result.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter((text) => text !== "")
		.join("\n");
}
