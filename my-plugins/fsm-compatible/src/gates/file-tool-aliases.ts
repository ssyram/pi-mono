import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * File tool aliases accepting CC (`file_path`, `old_string`), OC (`filePath`,
 * `oldString`), and Pi (`path`, `edits[].oldText`) parameter forms under CC,
 * OC, and Pi tool names. Direct fs — no SDK tool binding.
 */
const READ_PARAMS = Type.Object({
	file_path: Type.Optional(Type.String()),
	filePath: Type.Optional(Type.String()),
	path: Type.Optional(Type.String()),
	offset: Type.Optional(Type.Number()),
	limit: Type.Optional(Type.Number()),
});
const WRITE_PARAMS = Type.Object({
	file_path: Type.Optional(Type.String()),
	filePath: Type.Optional(Type.String()),
	path: Type.Optional(Type.String()),
	content: Type.String(),
});
const EDIT_PARAMS = Type.Object({
	file_path: Type.Optional(Type.String()),
	filePath: Type.Optional(Type.String()),
	path: Type.Optional(Type.String()),
	old_string: Type.Optional(Type.String()),
	new_string: Type.Optional(Type.String()),
	oldString: Type.Optional(Type.String()),
	newString: Type.Optional(Type.String()),
	edits: Type.Optional(Type.Array(Type.Object({
		old_string: Type.Optional(Type.String()),
		new_string: Type.Optional(Type.String()),
		oldString: Type.Optional(Type.String()),
		newString: Type.Optional(Type.String()),
		oldText: Type.Optional(Type.String()),
		newText: Type.Optional(Type.String()),
	}))),
});

function resolvePath(input: Record<string, unknown>): string | undefined {
	const fp = input.path ?? input.filePath ?? input.file_path;
	return typeof fp === "string" ? fp : undefined;
}

type Execute = (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

async function readExecute(_id: string, params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
	const input = params as Record<string, unknown>;
	const path = resolvePath(input);
	if (!path) throw new Error("read requires file_path/filePath/path");
	const content = await readFile(path, "utf8");
	const offset = typeof input.offset === "number" ? input.offset : 1;
	const limit = typeof input.limit === "number" ? input.limit : 2000;
	const lines = content.split("\n");
	return { content: [{ type: "text", text: lines.slice(offset - 1, offset - 1 + limit).join("\n") }] };
}

async function writeExecute(_id: string, params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
	const input = params as Record<string, unknown>;
	const path = resolvePath(input);
	const content = input.content;
	if (!path || typeof content !== "string") throw new Error("write requires file_path/filePath/path and content");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
	return { content: [{ type: "text", text: `wrote ${path}` }] };
}

async function editExecute(_id: string, params: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
	const input = params as Record<string, unknown>;
	const path = resolvePath(input);
	if (!path) throw new Error("edit requires file_path/filePath/path");
	const pairs: Array<[string, string]> = [];
	const single = [input.old_string ?? input.oldString, input.new_string ?? input.newString];
	if (typeof single[0] === "string" && typeof single[1] === "string") pairs.push([single[0], single[1]]);
	for (const entry of Array.isArray(input.edits) ? input.edits : []) {
		const e = entry as Record<string, unknown>;
		const old = e.old_string ?? e.oldString ?? e.oldText;
		const neu = e.new_string ?? e.newString ?? e.newText;
		if (typeof old !== "string" || typeof neu !== "string") throw new Error("edit entry requires old/new pair");
		pairs.push([old, neu]);
	}
	if (pairs.length === 0) throw new Error("edit requires old_string/new_string or edits[]");
	let content = await readFile(path, "utf8");
	for (const [oldStr, newStr] of pairs) {
		if (!content.includes(oldStr)) throw new Error(`old_string not found in ${path}`);
		content = content.replace(oldStr, newStr);
	}
	await writeFile(path, content, "utf8");
	return { content: [{ type: "text", text: `edited ${path} (${pairs.length} edit${pairs.length > 1 ? "s" : ""})` }] };
}

function reg(pi: ExtensionAPI, name: string, description: string, parameters: object, execute: Execute): void {
	pi.registerTool({ name, label: name, description, parameters, execute } as never);
}

export function registerFileToolAliases(pi: ExtensionAPI): void {
	reg(pi, "read", "Read file contents (accepts file_path/filePath/path)", READ_PARAMS, readExecute);
	reg(pi, "Read", "Read file contents (CC name; accepts file_path/filePath/path)", READ_PARAMS, readExecute);
	reg(pi, "write", "Write file contents (accepts file_path/filePath/path)", WRITE_PARAMS, writeExecute);
	reg(pi, "Write", "Write file contents (CC name; accepts file_path/filePath/path)", WRITE_PARAMS, writeExecute);
	reg(pi, "edit", "Edit file with old/new pairs or edits[]", EDIT_PARAMS, editExecute);
	reg(pi, "Edit", "Edit file with old/new pairs or edits[] (CC name)", EDIT_PARAMS, editExecute);
}
