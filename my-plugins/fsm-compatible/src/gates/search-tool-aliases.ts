import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve } from "node:path";

/**
 * Search tool aliases: Grep/grep, Glob/glob/find, LS/ls under CC and OC/Pi names.
 * Delegates to Pi's native tool implementations — no hand-rolled glob matching
 * or directory walking. OC's `include` param is accepted alongside `glob`.
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

type NativeExecute = (toolCallId: string, args: unknown, signal?: AbortSignal, onProgress?: (update: unknown) => void, ctx?: unknown) => Promise<unknown>;
type AliasExecute = (id: string, params: unknown, signal?: AbortSignal, onProgress?: (update: unknown) => void) => Promise<unknown>;

function adapt(native: unknown, cwd: string): AliasExecute {
	return async (id, params, signal, onProgress) => {
		const input = params as Record<string, unknown>;
		if (typeof input.path === "string") input.path = resolve(cwd, input.path);
		if (typeof input.include === "string" && typeof input.glob !== "string") input.glob = input.include;
		return ((native as { execute: unknown }).execute as (id: string, args: unknown, signal?: AbortSignal, onProgress?: (u: unknown) => void) => Promise<unknown>)(id, input, signal, onProgress);
	};
}

export function registerSearchToolAliases(pi: ExtensionAPI, cwd = process.cwd()): void {
	const nativeGrep = createGrepToolDefinition(cwd);
	const nativeFind = createFindToolDefinition(cwd);
	const nativeLs = createLsToolDefinition(cwd);
	const grep = adapt(nativeGrep, cwd);
	const find = adapt(nativeFind, cwd);
	const ls = adapt(nativeLs, cwd);

	const reg = (_pi: ExtensionAPI, name: string, description: string, parameters: object, execute: AliasExecute): void => {
		pi.registerTool({ name, label: name, description, parameters, execute } as never);
	};
	reg(pi, "glob", "Find files by glob pattern", GLOB_PARAMS, find);
}
