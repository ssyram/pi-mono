import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Search tool aliases: Grep/grep (pattern over files), Glob/glob/find
 * (file pattern), LS/ls (directory listing) under CC and OC/Pi names.
 * OC grep's `include` param is accepted alongside `glob`.
 */
const GREP_PARAMS = Type.Object({
	pattern: Type.String(),
	path: Type.Optional(Type.String()),
	glob: Type.Optional(Type.String()),
	include: Type.Optional(Type.String()),
});
const GLOB_PARAMS = Type.Object({
	pattern: Type.String(),
	path: Type.Optional(Type.String()),
});
const LS_PARAMS = Type.Object({
	path: Type.Optional(Type.String()),
});

const MAX_MATCH_LINES = 100;
const MAX_WALK_FILES = 5000;

function globToRegExp(pattern: string): RegExp {
	let re = "";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i] ?? "";
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				re += ".*";
				i++;
				if (pattern[i + 1] === "/") i++;
			} else {
				re += "[^/]*";
			}
		} else if (ch === "?") {
			re += "[^/]";
		} else {
			re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${re}$`);
}

async function walkFiles(root: string, out: string[]): Promise<void> {
	if (out.length >= MAX_WALK_FILES) return;
	const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined);
	if (!entries) return;
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			await walkFiles(full, out);
		} else {
			out.push(full);
			if (out.length >= MAX_WALK_FILES) return;
		}
	}
}

async function grepExecute(_id: string, params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
	const input = params as Record<string, unknown>;
	const pattern = input.pattern as string;
	const root = (input.path as string) ?? process.cwd();
	const filterGlob = (input.glob ?? input.include) as string | undefined;
	const info = await stat(root).catch(() => undefined);
	if (!info) throw new Error(`grep path not found: ${root}`);
	const files = info.isDirectory() ? (() => [])() : [root];
	let candidates: string[];
	if (info.isDirectory()) {
		const all: string[] = [];
		await walkFiles(root, all);
		const re = filterGlob ? globToRegExp(filterGlob) : undefined;
		candidates = re ? all.filter((f) => re.test(f) || re.test(f.split("/").pop() ?? "")) : all;
	} else {
		candidates = files;
	}
	const regex = new RegExp(pattern);
	const lines: string[] = [];
	for (const file of candidates) {
		if (lines.length >= MAX_MATCH_LINES) break;
		const text = await readFile(file, "utf8").catch(() => undefined);
		if (text === undefined) continue;
		const textLines = text.split("\n");
		for (let i = 0; i < textLines.length && lines.length < MAX_MATCH_LINES; i++) {
			const line = textLines[i] ?? "";
			if (regex.test(line)) lines.push(`${file}:${i + 1}:${line}`);
		}
	}
	return { content: [{ type: "text", text: lines.length ? lines.join("\n") : "no matches" }] };
}

async function globExecute(_id: string, params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
	const input = params as Record<string, unknown>;
	const pattern = input.pattern as string;
	const root = (input.path as string) ?? process.cwd();
	const re = globToRegExp(pattern);
	const all: string[] = [];
	await walkFiles(root, all);
	const matches = all.filter((f) => re.test(relative(root, f)) || re.test(f));
	if (matches.length === 0) {
		const info = await stat(root).catch(() => undefined);
		if (info?.isFile() && re.test(root)) matches.push(root);
	}
	return { content: [{ type: "text", text: matches.length ? matches.join("\n") : "no matches" }] };
}

async function lsExecute(_id: string, params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
	const input = params as Record<string, unknown>;
	const root = (input.path as string) ?? process.cwd();
	const entries = await readdir(root, { withFileTypes: true });
	const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
	return { content: [{ type: "text", text: lines.join("\n") }] };
}

type Execute = (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

function reg(pi: ExtensionAPI, name: string, description: string, parameters: object, execute: Execute): void {
	pi.registerTool({ name, label: name, description, parameters, execute } as never);
}

export function registerSearchToolAliases(pi: ExtensionAPI): void {
	reg(pi, "grep", "Search file contents by regex (accepts glob/include filter)", GREP_PARAMS, grepExecute);
	reg(pi, "Grep", "Search file contents by regex (CC name; accepts glob/include)", GREP_PARAMS, grepExecute);
	reg(pi, "glob", "Find files by glob pattern", GLOB_PARAMS, globExecute);
	reg(pi, "Glob", "Find files by glob pattern (CC name)", GLOB_PARAMS, globExecute);
	reg(pi, "ls", "List directory contents", LS_PARAMS, lsExecute);
	reg(pi, "LS", "List directory contents (CC name)", LS_PARAMS, lsExecute);
}
