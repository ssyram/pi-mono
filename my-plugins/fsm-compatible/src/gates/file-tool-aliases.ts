import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve } from "node:path";

/**
 * File tool aliases for CC/OC names (Read/Write/Edit). Delegates to Pi's
 * native tool implementations — file mutation queue, diff rendering,
 * truncation, and image support all remain native. CC/OC parameter forms
 * (file_path, old_string) are adapted to Pi's native shapes. Pi's own
 * lowercase tool names (read/write/edit) are NOT re-registered here —
 * the native registrations stay untouched.
 *
 * FSM permission checks translate names at the gate boundary
 * (permission-gate.ts normalizeToolCall), not here.
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
		oldText: Type.Optional(Type.String()),
		newText: Type.Optional(Type.String()),
		old_string: Type.Optional(Type.String()),
		new_string: Type.Optional(Type.String()),
	})) ),
	replace_all: Type.Optional(Type.Boolean()),
});

type AliasExecute = (id: string, params: unknown, signal?: AbortSignal, onProgress?: (update: unknown) => void) => Promise<unknown>;

function pickPath(input: Record<string, unknown>): string | undefined {
	const raw = (input.file_path ?? input.filePath ?? input.path) as string | undefined;
	return raw;
}

function adaptRead(native: unknown, cwd: string): AliasExecute {
	return async (id, params, signal, onProgress) => {
		const input = params as Record<string, unknown>;
		const path = pickPath(input);
		return ((native as { execute: unknown }).execute as (id: string, args: unknown, signal?: AbortSignal, onProgress?: (u: unknown) => void) => Promise<unknown>)(id, { path: path ? resolve(cwd, path) : undefined, offset: input.offset, limit: input.limit }, signal, onProgress);
	};
}

function adaptWrite(native: unknown, cwd: string): AliasExecute {
	return async (id, params, signal, onProgress) => {
		const input = params as Record<string, unknown>;
		const path = pickPath(input);
		return ((native as { execute: unknown }).execute as (id: string, args: unknown, signal?: AbortSignal, onProgress?: (u: unknown) => void) => Promise<unknown>)(id, { path: path ? resolve(cwd, path) : undefined, content: input.content }, signal, onProgress);
	};
}

function adaptEdit(native: unknown, cwd: string): AliasExecute {
	return async (id, params, signal, onProgress) => {
		const input = params as Record<string, unknown>;
		const path = pickPath(input);
		const replaceAll = input.replace_all === true || input.replaceAll === true;
		if (Array.isArray(input.edits)) {
			const edits = input.edits.map((edit) => {
				const item = edit as Record<string, unknown>;
				return { oldText: (item.oldText ?? item.old_string) as string, newText: (item.newText ?? item.new_string) as string };
			});
			return ((native as { execute: unknown }).execute as (id: string, args: unknown, signal?: AbortSignal, onProgress?: (u: unknown) => void) => Promise<unknown>)(id, { path: path ? resolve(cwd, path) : undefined, edits, replaceAll }, signal, onProgress);
		}
		const oldText = (input.old_string ?? input.oldString) as string | undefined;
		const newText = (input.new_string ?? input.newString) as string | undefined;
		if (oldText === undefined || newText === undefined) throw new Error("Edit requires old_string/new_string or edits[]");
		return ((native as { execute: unknown }).execute as (id: string, args: unknown, signal?: AbortSignal, onProgress?: (u: unknown) => void) => Promise<unknown>)(id, { path: path ? resolve(cwd, path) : undefined, edits: [{ oldText, newText }], replaceAll }, signal, onProgress);
	};
}

export function registerFileToolAliases(pi: ExtensionAPI, cwd = process.cwd()): void {
	const nativeRead = createReadToolDefinition(cwd);
	const nativeWrite = createWriteToolDefinition(cwd);
	const nativeEdit = createEditToolDefinition(cwd);
	const read = adaptRead(nativeRead, cwd);
	const write = adaptWrite(nativeWrite, cwd);
	const edit = adaptEdit(nativeEdit, cwd);

	const reg = (_pi: ExtensionAPI, name: string, description: string, parameters: object, execute: AliasExecute): void => {
		pi.registerTool({ name, label: name, description, parameters, execute } as never);
	};
	// CC names only — Pi's native lowercase read/write/edit stay untouched.
	reg(pi, "Read", "Read file contents (CC name; accepts file_path/filePath/path)", READ_PARAMS, read);
	reg(pi, "Write", "Write file contents (CC name; accepts file_path/filePath/path)", WRITE_PARAMS, write);
	reg(pi, "Edit", "Edit file with old/new pairs or edits[] (CC name)", EDIT_PARAMS, edit);
	reg(pi, "MultiEdit", "Edit file with multiple old/new pairs (CC name)", EDIT_PARAMS, edit);
}
