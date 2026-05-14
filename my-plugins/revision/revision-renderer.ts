import type { MessageRenderer, Theme } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import type { RevisionDetails } from "./types.js";

const VALID_MODES: Set<string> = new Set(["default", "visible-summary", "no-summary"]);

function isRevisionDetails(details: unknown): details is RevisionDetails {
	if (typeof details !== "object" || details === null) return false;
	const d = details as Record<string, unknown>;
	return (
		typeof d.requestId === "string" &&
		typeof d.targetUserId === "string" &&
		typeof d.revisePrompt === "string" &&
		VALID_MODES.has(d.mode as string)
	);
}

function createRevisionRenderer(): MessageRenderer {
	return (message, options, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		const details = isRevisionDetails(message.details) ? message.details : undefined;

		const box = new Box(1, 0);

		// Header
		box.addChild(new Text(theme.fg("accent", "⟳ Revision")));

		// Show recap if available
		if (details?.recap) {
			if (options.expanded) {
				box.addChild(new Text(""));
				for (const line of details.recap.split("\n")) {
					box.addChild(new Text(theme.fg("muted", `  ${line}`)));
				}
			} else {
				const firstLine = details.recap.split("\n")[0] ?? "";
				const truncated = firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
				box.addChild(new Text(theme.fg("muted", truncated)));
			}
		}

		// Content lines (omitted notice)
		if (content) {
			const lines = content.split("\n").filter((line) => line.trim());
			if (!options.expanded && lines.length > 3) {
				for (const line of lines.slice(0, 3)) {
					box.addChild(new Text(theme.fg("muted", line)));
				}
				box.addChild(new Text(theme.fg("dim", "…")));
			} else {
				for (const line of lines) {
					box.addChild(new Text(theme.fg("muted", line)));
				}
			}
		}

		return box;
	};
}

export { createRevisionRenderer };