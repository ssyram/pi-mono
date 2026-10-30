import { createWriteTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, stat, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** HC's native tool schemas (real collect snapshot) are the wire contract. */
export async function loadHcToolSchemas(): Promise<Record<string, { description: string; parameters: Record<string, unknown> }>> {
	const raw = await readFile(join(import.meta.dirname, "../../data/hc-tool-schemas.json"), "utf8");
	return JSON.parse(raw);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; details?: { title?: string | null; metadata?: Record<string, unknown> | null; partStatus?: "error" } };

let cwdWork = "";

const rel = (target: string) => target.replace(`${cwdWork}/`, "");

async function renderRead(input: Record<string, unknown>): Promise<ToolResult> {
	const target = String(input.filePath ?? "");
	const limit = input.limit === undefined ? undefined : Number(input.limit);
	const offset = input.offset === undefined ? undefined : Number(input.offset);
	const info = await stat(target).catch(() => null);
	if (!info) return { content: [{ type: "text", text: `File not found: ${target}` }], isError: true };
	if (info.isDirectory()) {
		const names = (await readdir(target)).sort();
		const all: string[] = [];
		for (const name of names) all.push(name + ((await stat(join(target, name))).isDirectory() ? "/" : ""));
		const from = offset && offset > 0 ? offset : 1;
		const to = limit === undefined ? all.length : Math.max(from - 1, Math.min(from + limit - 1, all.length));
		const entries: string[] = [];
		for (let i = from; i <= to; i++) entries.push(all[i - 1] ?? "");
		const full = from === 1 && to === all.length && limit === undefined;
		const tail = full ? `(${all.length} entries)` : `(Showing ${entries.length} of ${all.length} entries. Use 'offset' parameter to read beyond entry ${to + 1})`;
		const text = `<path>${target}</path>\n<type>directory</type>\n<entries>\n${entries.join("\n")}\n\n${tail}\n</entries>`;
		return { content: [{ type: "text", text }], details: { title: rel(target),
			metadata: { preview: entries.join("\n"), truncated: !full, loaded: [],
				display: { type: "directory", path: target, entries, offset: from, totalEntries: all.length, truncated: !full } } } };
	}
	const all = (await readFile(target, "utf8")).split("\n");
	if (all.length && all[all.length - 1] === "") all.pop();
	const total = all.length;
	const from = offset && offset > 0 ? offset : 1;
	if (from > total) return { content: [{ type: "text", text: `Offset ${from} is out of range for this file (${total} lines)` }],
			details: { title: rel(target), metadata: null, partStatus: "error" } };
	const to = limit === undefined ? total : Math.max(from - 1, Math.min(from + limit - 1, total));
	const numbered: string[] = [];
	for (let i = from; i <= to; i++) numbered.push(`${i}: ${all[i - 1] ?? ""}`);
	const shown = numbered.map((n) => n.replace(/^\d+: /, ""));
	// Reading to the end of the file is an End-of-file window, even when the
	// window starts mid-file; only a truncated tail is a Showing window.
	const full = to === total;
	const tail = full ? `(End of file - total ${total} lines)` : `(Showing lines ${from}-${to} of ${total}. Use offset=${to + 1} to continue.)`;
	const text = `<path>${target}</path>\n<type>file</type>\n<content>\n${numbered.join("\n")}\n\n${tail}\n</content>`;
	return { content: [{ type: "text", text }], details: { title: rel(target),
		metadata: { preview: shown.join("\n"), truncated: !full, loaded: [],
			display: { type: "file", path: target, text: shown.join("\n"),
				lineStart: from, lineEnd: to, totalLines: total, truncated: !full } } } };
}

async function walkFiles(root: string, out: string[] = []): Promise<string[]> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) await walkFiles(full, out);
		else out.push(full);
	}
	return out;
}

async function listGlob(rootInput: string, pattern: string): Promise<string[]> {
	// HC paths are absolute on the wire; a "." root resolves to the cwd.
	const root = rootInput === "." ? process.cwd() : rootInput;
	// HC's glob applies shell patterns to full recursive listings: a single
	// `*` crosses directory separators (golden: `*.txt` matches nested/).
	// HC glob semantics: `*` and `?` cross directory separators; a `**`
	// segment collapses to "any depth, including zero" (golden `**/*.txt`
	// matches root files as well as nested ones).
	let regexSrc = "";
	for (const seg of pattern.split("/")) {
		if (seg === "**") { regexSrc += "(?:[^/]+/)*"; continue; }
		for (const ch of seg) {
			if (ch === "*") regexSrc += ".*";
			else if (ch === "?") regexSrc += "[^/]";
			else regexSrc += ch.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
		}
		regexSrc += "/";
	}
	const regex = new RegExp("^" + regexSrc.replace(/\/$/, "") + "$");
	// join() normalizes "./x" to "x", so a "." root must not slice a prefix.
	const rel = (f: string) => f.slice(root.length + 1);
	// macOS exec cwds carry a /private symlink prefix; strip it so paths
	// compare equal to the run's declared work directory.
	const strip = (f: string) => (f.startsWith("/private/") ? f.slice(8) : f);
	return (await walkFiles(root)).filter((f) => regex.test(rel(f))).map(strip).sort();
}

async function renderGlob(input: Record<string, unknown>): Promise<ToolResult> {
	const root = String(input.path ?? ".");
	// HC titles the part with the path relative to the work root; the work
	// root itself has no title.
	const title = root === "." ? "" : rel(root);
	const rootInfo = await stat(root).catch(() => null);
	if (rootInfo && !rootInfo.isDirectory()) return { content: [{ type: "text", text: `glob path must be a directory: ${root}` }], isError: true };
	const files = rootInfo?.isDirectory()
		? await listGlob(root, String(input.pattern ?? "*"))
		: [];
	if (files.length === 0) return { content: [{ type: "text", text: "No files found" }], details: { title, metadata: { count: 0, truncated: false } } };
	return { content: [{ type: "text", text: files.join("\n") }], details: { title, metadata: { count: files.length, truncated: false } } };
}

async function renderGrep(input: Record<string, unknown>): Promise<ToolResult> {
	const root = String(input.path ?? ".");
	const include = String(input.include ?? input.glob ?? "*");
	const pattern = String(input.pattern ?? "");
	if (!pattern) return { content: [{ type: "text", text: "pattern is required" }], isError: true };
	const regex = new RegExp(pattern);
	const listing = await renderGlob({ path: root, pattern: include });
	const noFiles: ToolResult = { content: [{ type: "text", text: "No files found" }],
		details: { title: String(input.pattern ?? ""), metadata: { matches: 0, truncated: false } } };
	if (listing.content[0]!.text === "No files found") return noFiles;
	const blocks: string[] = [];
	let count = 0;
	for (const file of listing.content[0]!.text.split("\n")) {
		const lines = (await readFile(file, "utf8").catch(() => "")).split("\n");
		if (lines.length && lines[lines.length - 1] === "") lines.pop();
		const hits: string[] = [];
		lines.forEach((line, i) => { if (regex.test(line)) { count++; hits.push(`  Line ${i + 1}: ${line}\n`); } });
		if (hits.length) blocks.push(`${file}:\n${hits.join("\n")}`);
	}
	if (count === 0) return noFiles;
	const title = String(input.pattern ?? "");
	return { content: [{ type: "text", text: `Found ${count} matches\n${blocks.join("\n\n")}` }], details: { title, metadata: { matches: count, truncated: false } } };
}

const EDIT_NOT_FOUND = "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.";
const EDIT_MULTIPLE = "Found multiple matches for oldString. Provide more surrounding context to make the match unique.";

async function runEdit(input: Record<string, unknown>): Promise<ToolResult> {
	const target = String(input.filePath ?? "");
	const oldString = String(input.oldString ?? "");
	const newString = String(input.newString ?? "");
	const replaceAll = input.replaceAll === true;
	const text = await readFile(target, "utf8").catch(() => null);
	if (text === null) return { content: [{ type: "text", text: `File not found: ${target}` }], isError: true };
	const occurrences = text.split(oldString).length - 1;
	if (oldString === newString) return { content: [{ type: "text", text: "No changes to apply: oldString and newString are identical." }], details: { title: null, metadata: null, partStatus: "error" } };
	if (occurrences === 0) return { content: [{ type: "text", text: EDIT_NOT_FOUND }], details: { title: null, metadata: null, partStatus: "error" } };
	if (!replaceAll && occurrences > 1) return { content: [{ type: "text", text: EDIT_MULTIPLE }], details: { title: null, metadata: null, partStatus: "error" } };
	const updated = replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, newString);
	const oldLines = text.split("\n");
	if (oldLines.length && oldLines[oldLines.length - 1] === "") oldLines.pop();
	// HC's edit diff is a line-aligned LCS over the whole file, rendered
	// as one hunk: unchanged lines are context, removals -, additions +,
	// in original order.
	const newLines = updated.split("\n");
	if (newLines.length && newLines[newLines.length - 1] === "") newLines.pop();
	const oldCount = oldLines.length, newCount = newLines.length;
	const lcs: number[][] = Array.from({ length: oldCount + 1 }, () => new Array(newCount + 1).fill(0));
	for (let i = oldCount - 1; i >= 0; i--) for (let j = newCount - 1; j >= 0; j--) {
		lcs[i]![j] = oldLines[i] === newLines[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
	}
	const hunk: string[] = [];
	let i = 0, j = 0, additions = 0, deletions = 0;
	while (i < oldCount && j < newCount) {
		if (oldLines[i] === newLines[j]) { hunk.push(` ${oldLines[i]}`); i++; j++; }
		else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { hunk.push(`-${oldLines[i]}`); i++; deletions++; }
		else { hunk.push(`+${newLines[j]}`); j++; additions++; }
	}
	while (i < oldCount) { hunk.push(`-${oldLines[i]}`); i++; deletions++; }
	while (j < newCount) { hunk.push(`+${newLines[j]}`); j++; additions++; }
	const patch = `Index: ${target}\n===================================================================\n--- ${target}\n+++ ${target}\n@@ -1,${oldCount} +1,${newCount} @@\n${hunk.join("\n")}\n`;
	await writeFile(target, updated);
	return { content: [{ type: "text", text: "Edit applied successfully." }], details: { title: rel(target),
		metadata: { diagnostics: {}, diff: patch,
			filediff: { file: target, patch, additions, deletions },
			truncated: false } } };
}

const ADAPTERS: Record<string, { run: (input: Record<string, unknown>, cwd: string) => Promise<ToolResult> }> = {
	read: { run: (i) => renderRead(i) },
	write: {
		run: async (i, cwd) => {
			const target = String(i.filePath);
			const targetInfo = await stat(target).catch(() => null);
			// HC resolves write targets through its resource layer: a directory
			// target or a path under a non-directory fails as BadResource
			// (surfaced as a normal result, not a transport error).
			if (targetInfo?.isDirectory()) return { content: [{ type: "text", text: `BadResource: FileSystem.readFile (${target})` }],
				details: { title: null, metadata: null, partStatus: "error" } };
			const parent = target.slice(0, target.lastIndexOf("/"));
			const parentInfo = parent ? await stat(parent).catch(() => null) : null;
			if (parentInfo && !parentInfo.isDirectory()) return { content: [{ type: "text", text: `BadResource: FileSystem.writeFile (${target})` }],
				details: { title: null, metadata: null, partStatus: "error" } };
			const existed = Boolean(targetInfo);
			const tool = createWriteTool(cwd) as unknown as { execute: (id: string, input: never) => Promise<unknown> };
			await tool.execute("hc_write", { path: String(i.filePath), content: String(i.content ?? "") } as never);
			return { content: [{ type: "text", text: "Wrote file successfully." }], details: { title: rel(String(i.filePath)),
				metadata: { diagnostics: {}, filepath: String(i.filePath), exists: existed, truncated: false } } };
		},
	},
	edit: { run: (i) => runEdit(i) },
	grep: { run: (i) => renderGrep(i) },
	glob: { run: (i) => renderGlob(i) },
};

/**
 * Register the file/search tools under HC's exact wire schema. Executors
 * inline factory instances or faithful renderers — no getTool lookup, no
 * active-set timing, nothing to shadow.
 */
export async function registerHcNativeTools(pi: ExtensionAPI, cwd: string): Promise<() => void> {
	cwdWork = cwd;
	const schemas = await loadHcToolSchemas();
	for (const [name, adapter] of Object.entries(ADAPTERS)) {
		const schema = schemas[name];
		if (!schema) continue;
		pi.registerTool({
			name,
			label: name,
			description: schema.description,
			parameters: schema.parameters as never,
			async execute(_id: string, input: Record<string, unknown>) {
				return adapter.run(input, cwd);
			},
		} as never);
	}
	return () => { /* registerTool has no unregister */ };
}
