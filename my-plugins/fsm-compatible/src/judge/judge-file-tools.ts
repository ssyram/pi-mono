import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	createBashTool, createEditTool, createFindTool, createGrepTool, createReadTool, withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { readDirectoryWindow } from "./judge-directory-read.ts";
import { resolveScopedPath } from "./judge-path-scope.ts";

export interface JudgeToolResult {
	readonly content: string;
	readonly isError: boolean;
	readonly details?: unknown;
}
type Signal = AbortSignal | undefined;
type SdkTool = { execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { type: string; text?: string }[] }> };

async function runSdk(tool: SdkTool, params: unknown, signal?: Signal): Promise<JudgeToolResult> {
	try {
		const result = await tool.execute("judge", params, signal);
		return { content: result.content.map((block) => block.text ?? "").join("\n"), isError: false };
	} catch (error) {
		return { content: error instanceof Error ? error.message : "tool failed", isError: true };
	}
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value) throw new RuntimeError("protocol-invalid");
	return value;
}
function optionalIndex(value: unknown): number | undefined {
	return value === undefined ? undefined : (() => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new RuntimeError("protocol-invalid"); return value; })();
}

export function createJudgeFileTools(cwd: string, allowExternal: boolean) {
	const read = createReadTool(cwd);
	const grep = createGrepTool(cwd);
	const find = createFindTool(cwd);
	const edit = createEditTool(cwd);

	return {
		async read(input: unknown, signal?: Signal): Promise<JudgeToolResult> {
			if (!isAdmissionObject(input)) throw new RuntimeError("protocol-invalid");
			const target = resolveScopedPath(cwd, requireString(input.filePath, "filePath"), allowExternal);
			const offset = optionalIndex(input.offset);
			const limit = optionalIndex(input.limit);
			const info = await stat(target).catch(() => undefined);
			if (info?.isDirectory()) {
				const window = await readDirectoryWindow(target, offset, limit);
				return { content: window.output, isError: false, details: { type: "directory", path: window.path,
					entries: window.entries, offset: window.offset, totalEntries: window.totalEntries, truncated: window.truncated,
					preview: window.preview } };
			}
			// HC Read renders file lines numbered ("N: line"); the reviewer's
			// FSM-visible receipt must match that format, not the SDK's bare text.
			const plain = await runSdk(read as unknown as SdkTool, { path: target, offset: offset || 1, limit }, signal);
			const lines = plain.content.split("\n").filter((line, index, all) => line !== "" || index !== all.length - 1);
			const numbered = lines.map((line, index) => `${(offset || 1) + index}: ${line}`);
			// HC Read wraps numbered lines in its file envelope.
			const content = `<path>${target}</path>\n<type>file</type>\n<content>\n${numbered.join("\n")}\n\n(End of file - total ${lines.length} lines)\n</content>`;
			return { ...plain, content };
		},
		async grep(input: unknown, signal?: Signal): Promise<JudgeToolResult> {
			if (!isAdmissionObject(input)) throw new RuntimeError("protocol-invalid");
			const pattern = requireString(input.pattern, "pattern");
			const path = input.path === undefined ? cwd : resolveScopedPath(cwd, requireString(input.path, "path"), allowExternal);
			return runSdk(grep as unknown as SdkTool, { pattern, path,
				glob: input.include === undefined ? undefined : requireString(input.include, "include"), limit: 100 }, signal);
		},
		async glob(input: unknown, signal?: Signal): Promise<JudgeToolResult> {
			if (!isAdmissionObject(input)) throw new RuntimeError("protocol-invalid");
			const pattern = requireString(input.pattern, "pattern");
			const path = input.path === undefined ? cwd : resolveScopedPath(cwd, requireString(input.path, "path"), allowExternal);
			return runSdk(find as unknown as SdkTool, { pattern, path, limit: 100 }, signal);
		},
		async bash(input: unknown, signal?: Signal): Promise<JudgeToolResult> {
			if (!isAdmissionObject(input)) throw new RuntimeError("protocol-invalid");
			const command = requireString(input.command, "command");
			const workdir = input.workdir === undefined ? cwd : resolveScopedPath(cwd, requireString(input.workdir, "workdir"), allowExternal);
			let timeoutSeconds: number | undefined;
			if (input.timeout !== undefined) {
				if (typeof input.timeout !== "number" || !Number.isSafeInteger(input.timeout) || input.timeout <= 0) throw new RuntimeError("protocol-invalid");
				timeoutSeconds = input.timeout / 1000;
			}
			const tool = createBashTool(workdir);
			return runSdk(tool as unknown as SdkTool, { command, ...(timeoutSeconds === undefined ? {} : { timeout: timeoutSeconds }) }, signal);
		},
		async edit(input: unknown, signal?: Signal): Promise<JudgeToolResult> {
			if (!isAdmissionObject(input)) throw new RuntimeError("protocol-invalid");
			const filePath = requireString(input.filePath, "filePath");
			if (typeof input.oldString !== "string" || typeof input.newString !== "string") throw new RuntimeError("protocol-invalid");
			const oldString = input.oldString;
			const newString = input.newString;
			if (oldString === newString) return { content: "oldString and newString are identical", isError: true };
			const target = resolveScopedPath(cwd, filePath, allowExternal);
			if (oldString !== "" && input.replaceAll !== true) {
				return runSdk(edit as unknown as SdkTool, { path: target, edits: [{ oldText: oldString, newText: newString }] }, signal);
			}
			return withFileMutationQueue(target, async () => {
				if (signal?.aborted) throw new RuntimeError("cancelled");
				const exists = await stat(target).then(() => true, () => false);
				if (signal?.aborted) throw new RuntimeError("cancelled");
				if (oldString === "") {
					if (exists) return { content: "oldString cannot be empty when editing an existing file", isError: true };
					await mkdir(dirname(target), { recursive: true });
					if (signal?.aborted) throw new RuntimeError("cancelled");
					await writeFile(target, newString, { flag: "wx" });
					return { content: `created ${target}`, isError: false };
				}
				const raw = await readFile(target, "utf8");
				if (signal?.aborted) throw new RuntimeError("cancelled");
				if (!raw.includes(oldString)) return { content: "oldString not found; no replacement made", isError: true };
				let updated = "";
				let cursor = 0;
				for (;;) {
					const hit = raw.indexOf(oldString, cursor);
					if (hit < 0) break;
					updated += raw.slice(cursor, hit) + newString;
					cursor = hit + oldString.length;
				}
				updated += raw.slice(cursor);
				if (signal?.aborted) throw new RuntimeError("cancelled");
				await writeFile(target, updated, "utf8");
				return { content: `replaced all occurrences in ${target}`, isError: false };
			});
		},
	};
}
