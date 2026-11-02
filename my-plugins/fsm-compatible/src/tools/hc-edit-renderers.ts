// Official-looking presentation for the HC edit/write tools. The built-in
// renderers are not importable from the host package, so this reproduces their
// visuals with the same public `renderDiff` primitive, fed from the HC wire
// result shapes (details.metadata.filediff.patch / write metadata) instead of
// the host's details.diff — the wire formats the dual harness asserts stay
// untouched.

import { renderDiff, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface HcEditArgsLike {
	filePath?: unknown;
	oldString?: unknown;
	newString?: unknown;
}

interface HcWriteArgsLike {
	filePath?: unknown;
	content?: unknown;
}

interface HcEditResultLike {
	isError?: boolean;
	details?: { metadata?: { diff?: unknown; filediff?: { patch?: unknown } } };
	content?: Array<{ type: string; text?: string }>;
}

function text(component: unknown): string {
	return String((component as { render(w: number): string[] }).render?.(200)?.map((line) => line.trimEnd()).join("\n") ?? component);
}

function oneLine(line: string): string {
	return line.length > 78 ? `${line.slice(0, 75)}...` : line;
}

/** Up to `max` non-empty lines of `body`, official-edit-preview style. */
function previewLines(body: string, max: number): string[] {
	const lines = body.split("\n").filter((line) => line.trim() !== "").slice(0, max);
	return lines.map(oneLine);
}

function editCallPreview(args: HcEditArgsLike): string[] {
	const lines: string[] = [];
	if (typeof args.oldString === "string") for (const line of previewLines(args.oldString, 3)) lines.push(`- ${line}`);
	if (typeof args.newString === "string") for (const line of previewLines(args.newString, 3)) lines.push(`+ ${line}`);
	return lines;
}

/** Renders the HC edit call/result like the host's built-in edit tool. */
export const hcEditRenderers: ToolRenderers = {
	renderCall(args, theme) {
		const typed = (args ?? {}) as HcEditArgsLike;
		const path = typeof typed.filePath === "string" ? typed.filePath : "";
		const head = `${theme.fg("toolTitle", "edit")} ${theme.fg("toolTitle", path)}`;
		const preview = editCallPreview(typed);
		return new Text(preview.length === 0 ? head : [head, ...preview].join("\n"), 0, 0);
	},
	renderResult(result, _options, theme) {
		const typed = result as HcEditResultLike;
		const patch = typeof typed.details?.metadata?.filediff?.patch === "string"
			? typed.details.metadata.filediff.patch
			: typeof typed.details?.metadata?.diff === "string" ? typed.details.metadata.diff : undefined;
		if (typed.isError || patch === undefined) {
			const body = typed.content?.map((part) => part.text ?? "").join("\n") ?? "";
			return new Text(theme.fg("toolOutput", body), 0, 0);
		}
		return new Text(renderDiff(patch), 0, 0);
	},
};

/** Renders the HC write call/result like the host's built-in write tool. */
export const hcWriteRenderers: ToolRenderers = {
	renderCall(args, theme) {
		const typed = (args ?? {}) as HcWriteArgsLike;
		const path = typeof typed.filePath === "string" ? typed.filePath : "";
		const head = `${theme.fg("toolTitle", "write")} ${theme.fg("toolTitle", path)}`;
		if (typeof typed.content !== "string") return new Text(head, 0, 0);
		const preview = previewLines(typed.content, 2);
		return new Text(preview.length === 0 ? head : [head, ...preview.map((line) => theme.fg("muted", line))].join("\n"), 0, 0);
	},
	renderResult(result, _options, theme) {
		const typed = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
		const body = typed.content?.map((part) => part.text ?? "").join("\n") ?? "";
		if (typed.isError || body === "") return new Text(theme.fg("toolOutput", body), 0, 0);
		return new Text(theme.fg("success", body), 0, 0);
	},
};

export const hcRendererTextForTest = text;
