/**
 * Collapsible TUI renderer for the provider-usage AI report custom message:
 * collapsed shows a one-line compact summary, click (or expand-all) toggles the full report.
 */
import type { ExtensionAPI, MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { Text, TruncatedText } from "@earendil-works/pi-tui";

export const USAGE_AI_MESSAGE_TYPE = "provider-usage-ai-report";

export interface UsageAiMessageDetails {
	collapsed: string;
}

/** Structural stand-in for the host CustomMessage (not exported by pi-coding-agent). */
interface AiReportMessage {
	content: string | readonly unknown[];
	details?: UsageAiMessageDetails;
}

/** Click-open survives resize rebuilds but follows the global expand-all toggle. */
class CollapsibleUsageMessage implements Component {
	private expanded = false;
	private externalExpanded: boolean | undefined;
	private readonly label: string;
	private readonly content: string;
	private readonly collapsed: string;

	constructor(label: string, content: string, collapsed: string) {
		this.label = label;
		this.content = content;
		this.collapsed = collapsed;
	}

	syncExpanded(expanded: boolean): void {
		if (this.externalExpanded !== expanded) {
			this.externalExpanded = expanded;
			this.expanded = expanded;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		this.expanded = !this.expanded;
		return { handled: true };
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.expanded) {
			return [...new Text(this.label, 0, 0).render(width), ...new Text(this.content, 0, 0).render(width)];
		}
		return [...new Text(this.label, 0, 0).render(width), ...new TruncatedText(this.collapsed, 0, 0).render(width)];
	}
}

function textContent(message: AiReportMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text")
		.map((part) => part.text)
		.join("\n");
}

// Messages replayed from old sessions lack details; fall back to default full rendering.
const instances = new WeakMap<AiReportMessage, CollapsibleUsageMessage>();

function usageAiMessageRenderer(
	message: AiReportMessage,
	options: { expanded: boolean },
	theme: Theme,
): Component | undefined {
	if (!message.details) return undefined;
	let component = instances.get(message);
	if (!component) {
		const label = theme.fg("customMessageLabel", "\x1b[1m[Provider Usage]\x1b[22m");
		component = new CollapsibleUsageMessage(label, textContent(message), message.details.collapsed);
		instances.set(message, component);
	}
	component.syncExpanded(options.expanded);
	return component;
}

/** `pi` is the host ExtensionAPI; typed loosely because the plugin keeps a narrow PiExtensionAPI contract. */
export function registerUsageAiMessageRenderer(pi: object): void {
	const rendererApi = pi as ExtensionAPI & {
		registerMessageRenderer(customType: string, renderer: MessageRenderer): void;
	};
	rendererApi.registerMessageRenderer(USAGE_AI_MESSAGE_TYPE, usageAiMessageRenderer);
}
