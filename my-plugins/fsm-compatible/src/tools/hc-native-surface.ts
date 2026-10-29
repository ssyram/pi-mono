import { createWriteTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, stat, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** HC's native tool schemas (real collect snapshot) are the wire contract. */
export async function loadHcToolSchemas(): Promise<Record<string, { description: string; parameters: Record<string, unknown> }>> {
	const raw = await readFile(join(import.meta.dirname, "../../data/hc-tool-schemas.json"), "utf8");
	return JSON.parse(raw);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; details?: { title?: string | null; metadata?: Record<string, unknown> | null } };

let cwdWork = "";

const rel = (target: string) => target.replace(`${cwdWork}/`, "");

async function renderRead(input: Record<string, unknown>): Promise<ToolResult> {
	const target = String(input.filePath ?? "");
	const limit = input.limit === undefined ? undefined : Number(input.limit);
	const offset = input.offset === undefined ? undefined : Number(input.offset);
	const info = await stat(target).catch(() => null);
	if (!info) return { content: [{ type: "text", text: `File not found: ${target}` }], isError: true };
	if (info.isDirectory()) return { content: [{ type: "text", text: `<path>${target}</path>\n<type>directory</type>\n` }] };
	const all = (await readFile(target, "utf8")).split("\n");
	if (all.length && all[all.length - 1] === "") all.pop();
	const total = all.length;
	const from = offset && offset > 0 ? offset : 1;
	const to = limit === undefined ? total : Math.max(from - 1, Math.min(from + limit - 1, total));
	const numbered: string[] = [];
	for (let i = from; i <= to; i++) numbered.push(`${i}: ${all[i - 1] ?? ""}`);
	const shown = numbered.map((n) => n.replace(/^\d+: /, ""));
	const full = from === 1 && to === total && limit === undefined;
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

async function listGlob(root: string, pattern: string): Promise<string[]> {
	const regex = new RegExp("^" + pattern.split("/").map((seg) => seg.replaceAll(".", "\\.").replaceAll("**", "(?:.*/)?").replaceAll("*", "[^/]*").replaceAll("?", ".")).join("/") + "$");
	return (await walkFiles(root)).filter((f) => regex.test(f.slice(root.length + 1))).sort();
}

async function renderGlob(input: Record<string, unknown>): Promise<ToolResult> {
	const root = String(input.path ?? ".");
	const files = (await stat(root).catch(() => null))?.isDirectory()
		? await listGlob(root, String(input.pattern ?? "*"))
		: [];
	const title = rel(root);
	if (files.length === 0) return { content: [{ type: "text", text: "No files found" }], details: { title, metadata: { count: 0, truncated: false } } };
	return { content: [{ type: "text", text: files.join("\n") }], details: { title, metadata: { count: files.length, truncated: false } } };
}

async function renderGrep(input: Record<string, unknown>): Promise<ToolResult> {
	const root = String(input.path ?? ".");
	const include = String(input.include ?? input.glob ?? "*");
	const regex = new RegExp(String(input.pattern ?? ""));
	const listing = await renderGlob({ path: root, pattern: include });
	if (listing.content[0]!.text === "No files found") return listing;
	const blocks: string[] = [];
	let count = 0;
	for (const file of listing.content[0]!.text.split("\n")) {
		const lines = (await readFile(file, "utf8").catch(() => "")).split("\n");
		if (lines.length && lines[lines.length - 1] === "") lines.pop();
		const hits: string[] = [];
		lines.forEach((line, i) => { if (regex.test(line)) { count++; hits.push(`  Line ${i + 1}: ${line}\n`); } });
		if (hits.length) blocks.push(`${file}:\n${hits.join("\n")}`);
	}
	const title = String(input.pattern ?? "");
	if (count === 0) return { content: [{ type: "text", text: "No files found" }], details: { title, metadata: { matches: 0, truncated: false } } };
	return { content: [{ type: "text", text: `Found ${count} matches\n${blocks.join("\n")}` }], details: { title, metadata: { matches: count, truncated: false } } };
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
	if (occurrences === 0) return { content: [{ type: "text", text: EDIT_NOT_FOUND }], details: { title: null, metadata: null } };
	if (!replaceAll && occurrences > 1) return { content: [{ type: "text", text: EDIT_MULTIPLE }], details: { title: null, metadata: null } };
	const updated = replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, newString);
	// HC's edit diff renders the whole file as one hunk: every occurrence's
	// -old lines together, then the +new lines, at the first hit position.
	const oldLines = text.split("\n");
	if (oldLines.length && oldLines[oldLines.length - 1] === "") oldLines.pop();
	const oldN = oldString.split("\n").length;
	const newN = newString.split("\n").length;
	const firstLine = oldString.split("\n")[0] ?? "";
	const hits: number[] = [];
	for (let i = oldLines.indexOf(firstLine, 0); i >= 0; i = oldLines.indexOf(firstLine, i + 1)) {
		hits.push(i);
		if (!replaceAll) break;
	}
	const first = hits.length ? Math.min(...hits) : 0;
	const skip = new Set<number>();
	for (const h of hits) for (let i = h; i < h + oldN; i++) skip.add(i);
	const hunk: string[] = [];
	for (let i = 0; i < oldLines.length; i++) {
		if (skip.has(i)) {
			if (i === first) {
				for (let h = 0; h < hits.length; h++) for (const l of oldString.split("\n")) hunk.push(`-${l}`);
				for (let h = 0; h < hits.length; h++) for (const l of newString.split("\n")) hunk.push(`+${l}`);
			}
			continue;
		}
		hunk.push(` ${oldLines[i]}`);
	}
	const patch = `Index: ${target}\n===================================================================\n--- ${target}\n+++ ${target}\n@@ -1,${oldLines.length} +1,${oldLines.length - oldN * hits.length + newN * hits.length} @@\n${hunk.join("\n")}\n`;
	await writeFile(target, updated);
	return { content: [{ type: "text", text: "Edit applied successfully." }], details: { title: rel(target),
		metadata: { diagnostics: {}, diff: patch,
			filediff: { file: target, patch, additions: newN * hits.length, deletions: oldN * hits.length },
			truncated: false } } };
}

const ADAPTERS: Record<string, { run: (input: Record<string, unknown>, cwd: string) => Promise<ToolResult> }> = {
	read: { run: (i) => renderRead(i) },
	write: {
		run: async (i, cwd) => {
			const existed = await stat(String(i.filePath)).then(() => true).catch(() => false);
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
