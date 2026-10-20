import { readdir, stat } from "node:fs/promises";
import { RuntimeError } from "../runtime/runtime-error.ts";

export interface DirectoryWindow {
	readonly path: string;
	readonly offset: number;
	readonly entries: readonly string[];
	readonly totalEntries: number;
	readonly truncated: boolean;
	readonly output: string;
	readonly preview: string;
}

const DEFAULT_LIMIT = 2000;

async function entryName(directory: string, item: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }): Promise<string> {
	if (!item.isSymbolicLink()) return item.isDirectory() ? `${item.name}/` : item.name;
	try {
		const target = await stat(join0(directory, item.name));
		return target.isDirectory() ? `${item.name}/` : item.name;
	} catch {
		return item.name;
	}
}

function join0(directory: string, name: string): string {
	return `${directory.replace(/\/+$/, "")}/${name}`;
}

/** OC directory read: full real listing, sorted, 1-indexed window. Never paginates an already-truncated view. */
export async function readDirectoryWindow(path: string, offsetInput: number | undefined, limitInput: number | undefined): Promise<DirectoryWindow> {
	if (offsetInput !== undefined && (!Number.isSafeInteger(offsetInput) || offsetInput < 0)) throw new RuntimeError("protocol-invalid");
	if (limitInput !== undefined && (!Number.isSafeInteger(limitInput) || limitInput < 0)) throw new RuntimeError("protocol-invalid");
	const items = await readdir(path, { withFileTypes: true });
	const names: string[] = [];
	for (const item of items) names.push(await entryName(path, item));
	names.sort((left, right) => left.localeCompare(right));
	const offset = offsetInput || 1;
	const limit = limitInput ?? DEFAULT_LIMIT;
	const start = offset - 1;
	const sliced = names.slice(start, start + limit);
	const truncated = start + sliced.length < names.length;
	const output = [
		`<path>${path}</path>`,
		"<type>directory</type>",
		"<entries>",
		sliced.join("\n"),
		truncated
			? `\n(Showing ${sliced.length} of ${names.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
			: `\n(${names.length} entries)`,
		"</entries>",
	].join("\n");
	return { path, offset, entries: Object.freeze(sliced), totalEntries: names.length, truncated, output,
		preview: sliced.slice(0, 20).join("\n") };
}
