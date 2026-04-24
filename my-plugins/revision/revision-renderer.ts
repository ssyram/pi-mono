import type { MessageRenderer, MessageRenderOptions, Theme } from "@mariozechner/pi-coding-agent";
import { Box, Text, type Component } from "@mariozechner/pi-tui";
import type { RevisionLiveState, RevisionMode } from "./types.js";

const VALID_MODES = new Set<RevisionMode>(["hidden-summary", "visible-summary", "no-summary"]);
const VALID_STATUSES = new Set(["running", "done", "error"]);

function isRevisionDetails(details: unknown): details is RevisionLiveState {
	if (typeof details !== "object" || details === null) return false;
	const value = details as Record<string, unknown>;
	if (typeof value.requestId !== "string") return false;
	if (typeof value.mode !== "string" || !VALID_MODES.has(value.mode as RevisionMode)) return false;
	if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status)) return false;
	if (value.recap !== undefined && typeof value.recap !== "string") return false;
	if (value.error !== undefined && typeof value.error !== "string") return false;
	return true;
}

function getTextLines(text: string): string[] {
	const lines = text.trim() ? text.trim().split(/\r?\n/) : [];
	return lines.length > 0 ? lines : ["Generating recap..."];
}

function buildLines(details: RevisionLiveState, expanded: boolean): string[] {
	const recap = details.recap || "";
	const error = details.error;
	const status = details.status;
	const baseLines = error ? [`Revision recap error: ${error}`] : getTextLines(recap);

	const header = status === "running" ? "Revision recap (running)" : status === "error" ? "Revision recap (error)" : "Revision recap";
	const visible = expanded ? baseLines : baseLines.slice(0, 4);
	return [header, ...visible.map((line) => (line.length > 120 ? `${line.slice(0, 117)}...` : line))];
}

function createRevisionRenderer(): MessageRenderer<unknown> {
	return (message, options: MessageRenderOptions, theme: Theme): Component | undefined => {
		if (!isRevisionDetails(message.details)) return undefined;
		const lines = buildLines(message.details, options.expanded);
		const box = new Box(1, 1);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			box.addChild(new Text(index === 0 ? theme.fg("accent", line) : theme.fg("muted", `  ${line}`), 0, 0));
		}
		return box;
	};
}

export { createRevisionRenderer };
