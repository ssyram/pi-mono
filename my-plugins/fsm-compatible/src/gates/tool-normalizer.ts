import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

export interface NormalizedToolCall {
	readonly toolName: string;
	readonly toolInput: Record<string, unknown>;
}
export type ToolCallLike = { readonly toolName: string; readonly input: unknown };

/**
 * FSM permission DSL matches CC-convention tool names (`Write`, `Bash`, ...).
 * Skill whitelists pair lowercase OC entries (`write` + `filePath`) with CC
 * entries (`Write` + `file_path`), and CC-only whitelists exist (wire7 CCV),
 * so CC canonical form is the universally matching shape.
 */
const NAME_TO_CC: Record<string, string> = {
	write: "Write",
	read: "Read",
	edit: "Edit",
	bash: "Bash",
	shell: "Bash",
	powershell: "Bash",
	grep: "Grep",
	find: "Glob",
	glob: "Glob",
	ls: "LS",
	subagent: "Agent",
	task: "Agent",
	agent: "Agent",
	dispatch_subagent: "Agent",
	websearch: "WebSearch",
	webfetch: "WebFetch",
};

function pick(source: Record<string, unknown>, key: string): Record<string, unknown> {
	return source[key] === undefined ? {} : { [key]: source[key] };
}

/** HC hook canonical: the model's input with key renames only — every other
 * field rides along (matching.md `read.filePath→Read.file_path` etc.). */
function renamed(input: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined) continue;
		const target = map[key] ?? key;
		if (target in out) continue;
		out[target] = value;
	}
	return out;
}

/** File path field: CC `file_path`, OC `filePath`, or Pi `path`. */
function ccFile(input: Record<string, unknown>): Record<string, unknown> {
	const fp = input.file_path ?? input.filePath ?? input.path;
	return typeof fp === "string" ? { file_path: fp } : {};
}

/** CC edit pair: `old_string`/`new_string` from CC, OC, or Pi field names. */
function ccEditPair(input: Record<string, unknown>): Record<string, string> | undefined {
	const old = input.old_string ?? input.oldString ?? input.oldText;
	const neu = input.new_string ?? input.newString ?? input.newText;
	if (typeof old === "string" && typeof neu === "string") {
		return { old_string: old, new_string: neu };
	}
	return undefined;
}

/**
 * Step P3: renames and carries fields only — never invents values, never drops
 * the checked path. Unknown tools pass through with their real names.
 */
export function normalizeToolCall(call: ToolCallLike): NormalizedToolCall {
	const name = call.toolName;
	const input = isAdmissionObject(call.input) ? call.input : {};
	const clone = <T>(value: T): T => structuredClone(value);
	switch (NAME_TO_CC[name] ?? name) {
		case "Write":
			return { toolName: "Write", toolInput: renamed(input, { filePath: "file_path", path: "file_path" }) };
		case "Edit": {
			const ccEdit = renamed(input, { filePath: "file_path", path: "file_path",
				oldText: "old_string", oldString: "old_string", newText: "new_string", newString: "new_string" });
			if (ccEditPair(input)) return { toolName: "Edit", toolInput: ccEdit };
			if (Array.isArray(input.edits)) {
				const edits = input.edits.map((entry) => {
					if (!isAdmissionObject(entry)) throw new RuntimeError("protocol-invalid");
					const pair = ccEditPair(entry);
					if (!pair) throw new RuntimeError("protocol-invalid");
					return pair;
				});
				return { toolName: "MultiEdit", toolInput: { ...renamed(input, { filePath: "file_path", path: "file_path", oldText: "", oldString: "", newText: "", newString: "" }), edits } };
			}
			return { toolName: "Edit", toolInput: ccEdit };
		}
		case "Read":
			return { toolName: "Read", toolInput: renamed(input, { filePath: "file_path", path: "file_path" }) };
		case "Bash":
			return { toolName: "Bash", toolInput: renamed(input, {}) };
		case "Grep":
			return { toolName: "Grep", toolInput: renamed(input, { include: "glob" }) };
		case "Glob":
			return { toolName: "Glob", toolInput: renamed(input, {}) };
		case "LS":
			return { toolName: "LS", toolInput: renamed(input, {}) };
		case "Agent":
			return { toolName: "Agent", toolInput: clone(input) };
		default:
			return { toolName: name, toolInput: clone(input) };
	}
}

/** FSM-projected tools are the FSM's own interface — exempt from the permission gate. */
export function isFsmProjectedTool(toolName: string): boolean {
	return toolName.startsWith("mcp__fsm__") || toolName.startsWith("fsm_");
}
