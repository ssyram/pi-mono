import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ImpressionEntry } from "./types.ts";

export function formatOriginalCall(entry: ImpressionEntry, theme: Theme): string {
	const input = entry.toolInput;
	const name = theme.fg("toolTitle", theme.bold(entry.toolName));
	if (!input || Object.keys(input).length === 0) return name;

	switch (entry.toolName) {
		case "read": {
			const path = (input.file_path ?? input.path) as string | undefined;
			if (!path) return name;
			const offset = input.offset as number | undefined;
			const limit = input.limit as number | undefined;
			let range = "";
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				range = theme.fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return `${name} ${theme.fg("accent", path)}${range}`;
		}
		case "bash": {
			const command = input.command as string | undefined;
			if (!command) return name;
			const display = command.length > 80 ? command.slice(0, 77) + "..." : command;
			return `${name} ${display}`;
		}
		case "write":
		case "edit": {
			const path = (input.file_path ?? input.path) as string | undefined;
			if (!path) return name;
			return `${name} ${theme.fg("accent", path)}`;
		}
		case "grep":
		case "find": {
			const pattern = (input.pattern ?? input.glob) as string | undefined;
			if (!pattern) return name;
			return `${name} ${pattern}`;
		}
		default: {
			const summary = JSON.stringify(input);
			const display = summary.length > 80 ? summary.slice(0, 77) + "..." : summary;
			return `${name} ${theme.fg("muted", display)}`;
		}
	}
}
