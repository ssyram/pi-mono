import type { FlowConfig, ParsedFSM, State, Action, Condition } from "./types.js";
import { isBuiltinCondition, expandBuiltinCondition } from "./builtin-registry.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARG_NAME_RE = /^[A-Za-z0-9_-]+$/;
const MAX_FLOW_BYTES = 2 * 1024 * 1024; // 2 MiB
const RESERVED_JS_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export function isReservedJsName(name: string): boolean {
	return RESERVED_JS_NAMES.has(name);
}

export class ParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ParseError";
	}
}

export function parseFlowConfig(content: string, filename: string): FlowConfig {
	if (Buffer.byteLength(content, "utf-8") > MAX_FLOW_BYTES) {
		throw new ParseError(`Flow config exceeds ${MAX_FLOW_BYTES} bytes; refusing to parse`);
	}
	// Normalize line endings so CRLF-authored files parse correctly
	content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	// Strip UTF-8 BOM if present — otherwise it leaks into the first key name.
	if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	let raw: unknown;

	if (ext === "json") {
		try {
			raw = JSON.parse(content);
		} catch (e) {
			throw new ParseError(`Invalid JSON: ${e instanceof Error ? e.message : e}`);
		}
	} else if (ext === "yaml" || ext === "yml") {
		raw = parseSimpleYaml(content);
	} else if (ext === "md") {
		const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) throw new ParseError("No YAML front matter found in .md file");
		raw = parseSimpleYaml(match[1]);
	} else {
		// Try JSON first, then YAML
		try {
			raw = JSON.parse(content);
		} catch {
			raw = parseSimpleYaml(content);
		}
	}

	return validateFlowConfig(raw);
}

function validateFlowConfig(raw: unknown): FlowConfig {
	if (typeof raw !== "object" || raw === null) {
		throw new ParseError("Flow config must be an object");
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.task_description !== "string" || !obj.task_description) {
		throw new ParseError("Missing or empty 'task_description'");
	}
	if (!Array.isArray(obj.states) || obj.states.length === 0) {
		throw new ParseError("'states' must be a non-empty array");
	}

	const states: State[] = [];
	for (const s of obj.states) {
		states.push(validateState(s));
	}

	return { task_description: obj.task_description, states };
}

function validateState(raw: unknown): State {
	if (typeof raw !== "object" || raw === null) {
		throw new ParseError("Each state must be an object");
	}
	const s = raw as Record<string, unknown>;
	if (typeof s.state_id !== "string" || !s.state_id) {
		throw new ParseError("State missing 'state_id'");
	}
	// $START and $END are sentinels; other state_ids must be env-var-safe identifiers
	if (s.state_id !== "$START" && s.state_id !== "$END" && !IDENT_RE.test(s.state_id)) {
		throw new ParseError(`state_id '${s.state_id}' must match /^[A-Za-z_][A-Za-z0-9_]*$/ (or be '$START' / '$END')`);
	}
	if (isReservedJsName(s.state_id)) {
		throw new ParseError(`state_id '${s.state_id}' is a reserved JS property name`);
	}
	if (typeof s.state_desc !== "string") {
		throw new ParseError(`State '${s.state_id}' missing 'state_desc'`);
	}

	const is_epsilon = !!s.is_epsilon;
	const actions: Action[] = [];

	if (s.state_id === "$END") {
		if (Array.isArray(s.actions) && s.actions.length > 0) {
			throw new ParseError(`$END state must not have actions (got ${s.actions.length})`);
		}
		if (is_epsilon) {
			throw new ParseError("$END state cannot be epsilon");
		}
	} else {
		if (!Array.isArray(s.actions) || s.actions.length === 0) {
			throw new ParseError(`State '${s.state_id}' must have at least one action (only $END can have none)`);
		}
		for (let i = 0; i < s.actions.length; i++) {
			const isLast = i === s.actions.length - 1;
			actions.push(validateAction(s.actions[i], s.state_id as string, is_epsilon, isLast));
		}
	}

	return { state_id: s.state_id, state_desc: s.state_desc as string, is_epsilon, actions };
}

function validateAction(raw: unknown, stateId: string, isEpsilon: boolean, isLast: boolean): Action {
	if (typeof raw !== "object" || raw === null) {
		throw new ParseError(`Action in state '${stateId}' must be an object`);
	}
	const a = raw as Record<string, unknown>;
	if (typeof a.action_id !== "string" || !a.action_id) {
		throw new ParseError(`Action in state '${stateId}' missing 'action_id'`);
	}
	if (!IDENT_RE.test(a.action_id)) {
		throw new ParseError(`action_id '${a.action_id}' must match /^[A-Za-z_][A-Za-z0-9_]*$/`);
	}
	if (isReservedJsName(a.action_id)) {
		throw new ParseError(`action_id '${a.action_id}' is a reserved JS property name`);
	}
	if (typeof a.action_desc !== "string") {
		throw new ParseError(`Action '${a.action_id}' in state '${stateId}' missing 'action_desc'`);
	}
	const condition = validateCondition(a.condition, a.action_id, stateId, isEpsilon, isLast);
	if (typeof a.next_state_id !== "string" || !a.next_state_id) {
		throw new ParseError(`Action '${a.action_id}' in state '${stateId}' missing 'next_state_id'`);
	}
	if (a.next_state_id === stateId) {
		throw new ParseError(`Action '${a.action_id}' in state '${stateId}' has self-loop (next_state_id = self)`);
	}

	const args: { arg_name: string; arg_desc: string }[] = [];
	if (a.arguments !== undefined && a.arguments !== null) {
		if (!Array.isArray(a.arguments)) {
			throw new ParseError(`Action '${a.action_id}' in state '${stateId}': 'arguments' must be an array (got ${typeof a.arguments})`);
		}
		if (isEpsilon && a.arguments.length > 0) {
			throw new ParseError(`Epsilon state '${stateId}' action '${a.action_id}' must have no arguments`);
		}
		const seen = new Set<string>();
		for (const arg of a.arguments) {
			if (typeof arg !== "object" || arg === null) throw new ParseError(`Invalid argument in action '${a.action_id}'`);
			const argObj = arg as Record<string, unknown>;
			if (typeof argObj.arg_name !== "string") throw new ParseError(`Argument missing 'arg_name' in action '${a.action_id}'`);
			if (argObj.arg_name.startsWith("$")) {
				throw new ParseError(`arg_name '${argObj.arg_name}' in action '${a.action_id}' must not start with '$' (reserved for interpolation tokens)`);
			}
			if (!ARG_NAME_RE.test(argObj.arg_name)) {
				throw new ParseError(`arg_name '${argObj.arg_name}' in action '${a.action_id}' must match /^[A-Za-z0-9_-]+$/ (letters, digits, underscores, hyphens only)`);
			}
			if (isReservedJsName(argObj.arg_name)) {
				throw new ParseError(`arg_name '${argObj.arg_name}' in action '${a.action_id}' is a reserved JS property name`);
			}
			if (seen.has(argObj.arg_name)) {
				throw new ParseError(`Duplicate arg_name '${argObj.arg_name}' in action '${a.action_id}'`);
			}
			seen.add(argObj.arg_name);
			if (typeof argObj.arg_desc !== "string") throw new ParseError(`Argument missing 'arg_desc' in action '${a.action_id}'`);
			args.push({ arg_name: argObj.arg_name, arg_desc: argObj.arg_desc });
		}
	}

	return {
		action_id: a.action_id,
		action_desc: a.action_desc as string,
		arguments: args,
		condition,
		next_state_id: a.next_state_id,
	};
}

function validateCondition(
	raw: unknown,
	actionId: string,
	stateId: string,
	isEpsilon: boolean,
	isLast: boolean,
): Condition {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ParseError(`Action '${actionId}' in state '${stateId}': 'condition' must be an object (either { default: true }, { builtin, args? }, or { cmd, args? })`);
	}
	const c = raw as Record<string, unknown>;

	if (isBuiltinCondition(c)) {
		let expanded: Record<string, unknown>;
		try {
			expanded = expandBuiltinCondition(c, actionId, stateId);
		} catch (e) {
			throw new ParseError((e as Error).message);
		}
		return validateCondition(expanded, actionId, stateId, isEpsilon, isLast);
	}

	const isDefault = c.default === true;
	const hasCmd = c.cmd !== undefined;

	if (isDefault && (hasCmd || c.args !== undefined)) {
		throw new ParseError(`Action '${actionId}' in state '${stateId}': condition cannot mix 'default: true' with 'cmd'/'args' (pick one form)`);
	}
	if (!isDefault && c.default !== undefined) {
		throw new ParseError(`Action '${actionId}' in state '${stateId}': condition.default must be omitted or equal to true (got ${JSON.stringify(c.default)})`);
	}

	// Epsilon-state default-placement rules
	if (isEpsilon) {
		if (isLast && !isDefault) {
			throw new ParseError(`Epsilon state '${stateId}' last action '${actionId}' must have condition { default: true }`);
		}
		if (!isLast && isDefault) {
			throw new ParseError(`Epsilon state '${stateId}' action '${actionId}' uses { default: true } but is not the last action (would make later actions unreachable)`);
		}
	} else if (isDefault) {
		throw new ParseError(`Non-epsilon state '${stateId}' action '${actionId}' cannot use { default: true }`);
	}

	if (isDefault) return { default: true };

	if (typeof c.cmd !== "string" || c.cmd.length === 0) {
		throw new ParseError(`Action '${actionId}' in state '${stateId}': condition.cmd must be a non-empty string`);
	}
	// Reject ambiguous relative paths in `cmd`: a flow-author writing
	// `scripts/foo.mjs` intends flow-relative but would silently get session-cwd-relative.
	// Bare names (`node`) → PATH lookup; absolute paths → unchanged; `./`/`../` → flow-relative.
	const isFlowRel = (s: string) => s.startsWith("./") || s.startsWith("../");
	const isAbsPath = (s: string) => s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);
	const isPathLike = (s: string) => s.includes("/") || s.includes("\\");
	if (isPathLike(c.cmd) && !isFlowRel(c.cmd) && !isAbsPath(c.cmd)) {
		throw new ParseError(`Action '${actionId}' in state '${stateId}': condition.cmd '${c.cmd}' is path-like but neither absolute nor prefixed with './' or '../' — prefix with './' to resolve relative to the flow file`);
	}
	let args: string[] = [];
	if (c.args !== undefined) {
		if (!Array.isArray(c.args)) {
			throw new ParseError(`Action '${actionId}' in state '${stateId}': condition.args must be an array of strings`);
		}
		args = c.args.map((v, i) => {
			if (typeof v !== "string") {
				throw new ParseError(`Action '${actionId}' in state '${stateId}': condition.args[${i}] must be a string (got ${typeof v})`);
			}
			return v;
		});
	}
	return { cmd: c.cmd, args };
}

export function buildFSM(config: FlowConfig): ParsedFSM {
	const stateMap = new Map<string, State>();
	let hasStart = false;
	let hasEnd = false;

	for (const s of config.states) {
		if (stateMap.has(s.state_id)) {
			throw new ParseError(`Duplicate state_id: '${s.state_id}'`);
		}
		stateMap.set(s.state_id, s);
		if (s.state_id === "$START") hasStart = true;
		if (s.state_id === "$END") hasEnd = true;
	}

	if (!hasStart) throw new ParseError("Missing $START state");
	if (!hasEnd) throw new ParseError("Missing $END state");

	// Validate all next_state_id references exist
	for (const s of config.states) {
		const actionIds = new Set<string>();
		for (const a of s.actions) {
			if (actionIds.has(a.action_id)) {
				throw new ParseError(`Duplicate action_id '${a.action_id}' in state '${s.state_id}'`);
			}
			actionIds.add(a.action_id);
			if (!stateMap.has(a.next_state_id)) {
				throw new ParseError(`Action '${a.action_id}' in state '${s.state_id}' references unknown state '${a.next_state_id}'`);
			}
		}
	}

	// (Per-action epsilon/$DEFAULT placement is already checked in validateCondition.)

	// Forward BFS: $START must reach $END
	const fwdVisited = new Set<string>();
	const fwdQueue = ["$START"];
	while (fwdQueue.length > 0) {
		const id = fwdQueue.shift()!;
		if (fwdVisited.has(id)) continue;
		fwdVisited.add(id);
		const st = stateMap.get(id);
		if (!st) continue;
		for (const a of st.actions) {
			if (!fwdVisited.has(a.next_state_id)) fwdQueue.push(a.next_state_id);
		}
	}
	if (!fwdVisited.has("$END")) {
		throw new ParseError("$END is not reachable from $START — flow would deadlock");
	}

	// Reverse BFS from $END: every state reachable from $START must be able to reach $END.
	// Build reverse adjacency (if state A has an action with next_state_id B, then B → A in reverse).
	const reverseAdj = new Map<string, string[]>();
	for (const s of config.states) {
		if (!reverseAdj.has(s.state_id)) reverseAdj.set(s.state_id, []);
		for (const a of s.actions) {
			const list = reverseAdj.get(a.next_state_id);
			if (list) list.push(s.state_id);
			else reverseAdj.set(a.next_state_id, [s.state_id]);
		}
	}
	const revVisited = new Set<string>();
	const revQueue = ["$END"];
	while (revQueue.length > 0) {
		const id = revQueue.shift()!;
		if (revVisited.has(id)) continue;
		revVisited.add(id);
		for (const pred of (reverseAdj.get(id) ?? [])) {
			if (!revVisited.has(pred)) revQueue.push(pred);
		}
	}
	// Every state that is forward-reachable from $START must also reverse-reach $END.
	const deadEnds: string[] = [];
	for (const id of fwdVisited) {
		if (id !== "$END" && !revVisited.has(id)) deadEnds.push(id);
	}
	if (deadEnds.length > 0) {
		throw new ParseError(
			`Dead-end states detected (reachable from $START but cannot reach $END): ${deadEnds.join(", ")}. ` +
			"Every state must have a path to $END — no dead loops allowed."
		);
	}

	return { task_description: config.task_description, states: stateMap };
}

// Minimal YAML parser (handles flat objects, arrays of objects, nested)
// For production we'd use js-yaml, but keeping stdlib-only
function parseSimpleYaml(text: string): unknown {
	// Delegate to JSON if the YAML is actually JSON
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return JSON.parse(trimmed);
	}

	// Use dynamic import for js-yaml if available, otherwise use inline parser
	// This is a synchronous function, so we'll do a basic YAML parse
	return parseYamlValue(text.split("\n"), 0).value;
}

interface YamlResult {
	value: unknown;
	nextLine: number;
}

function getIndent(line: string): number {
	const match = line.match(/^(\s*)/);
	const ws = match ? match[1] : "";
	if (ws.includes("\t")) {
		throw new ParseError("YAML input contains tab indentation; use spaces only");
	}
	return ws.length;
}

function isBlankOrComment(line: string): boolean {
	const t = line.trim();
	return t === "" || t.startsWith("#");
}

const MAX_YAML_DEPTH = 64;

function parseYamlValue(lines: string[], startLine: number, depth: number = 0): YamlResult {
	if (depth > MAX_YAML_DEPTH) {
		throw new ParseError(`YAML nesting exceeds ${MAX_YAML_DEPTH} levels at line ${startLine + 1}`);
	}
	// Skip blank/comment lines
	let i = startLine;
	while (i < lines.length && isBlankOrComment(lines[i])) i++;
	if (i >= lines.length) return { value: null, nextLine: i };

	const line = lines[i];
	const trimmed = line.trim();

	// Array item
	if (trimmed.startsWith("- ")) {
		return parseYamlArray(lines, i, getIndent(line), depth);
	}

	// Object (key: value)
	if (trimmed.includes(":")) {
		return parseYamlObject(lines, i, getIndent(line), depth);
	}

	return { value: parseScalar(trimmed), nextLine: i + 1 };
}

function parseYamlArray(lines: string[], startLine: number, baseIndent: number, depth: number = 0): YamlResult {
	const result: unknown[] = [];
	let i = startLine;

	while (i < lines.length) {
		if (isBlankOrComment(lines[i])) { i++; continue; }
		const indent = getIndent(lines[i]);
		if (indent < baseIndent) break;
		if (indent !== baseIndent) break;

		const trimmed = lines[i].trim();
		if (!trimmed.startsWith("- ")) break;

		const afterDash = trimmed.slice(2).trim();

		if (afterDash.includes(":") && !afterDash.startsWith('"') && !afterDash.startsWith("'")) {
			// Inline object start: - key: value
			const obj: Record<string, unknown> = {};
			const { key, val } = parseKeyValue(afterDash);
			if (val !== undefined) {
				obj[key] = val;
			}
			i++;
			// Collect continuation lines at deeper indent
			while (i < lines.length) {
				if (isBlankOrComment(lines[i])) { i++; continue; }
				const ci = getIndent(lines[i]);
				if (ci <= baseIndent) break;
				const ct = lines[i].trim();
				if (ct.includes(":")) {
					const { key: ck, val: cv, blockScalar: cbs } = parseKeyValue(ct);
					if (cv !== undefined) {
						obj[ck] = cv;
						i++;
						continue;
					} else if (cbs) {
						const blk = readBlockScalar(lines, i + 1, ci, cbs);
						obj[ck] = blk.value;
						i = blk.nextLine;
						continue;
					} else {
						// Nested structure
						const sub = parseYamlValue(lines, i + 1, depth + 1);
						obj[ck] = sub.value;
						i = sub.nextLine;
						continue;
					}
				}
				throw new ParseError(`Unexpected non-key line at line ${i + 1}: '${ct}' (expected 'key: value' at indent ${ci})`);
			}
			result.push(obj);
		} else {
			// Simple array item
			result.push(parseScalar(afterDash));
			i++;
		}
	}

	return { value: result, nextLine: i };
}

function parseYamlObject(lines: string[], startLine: number, baseIndent: number, depth: number = 0): YamlResult {
	const result: Record<string, unknown> = {};
	let i = startLine;

	while (i < lines.length) {
		if (isBlankOrComment(lines[i])) { i++; continue; }
		const indent = getIndent(lines[i]);
		if (indent < baseIndent) break;
		if (indent !== baseIndent) {
			// A deeper-indent line at this level is a malformed continuation, not silent skip.
			throw new ParseError(`Unexpected indentation at line ${i + 1} (expected ${baseIndent} spaces, got ${indent})`);
		}

		const trimmed = lines[i].trim();
		if (!trimmed.includes(":")) break;

		const { key, val, blockScalar } = parseKeyValue(trimmed);
		if (val !== undefined) {
			result[key] = val;
			i++;
		} else if (blockScalar) {
			const blk = readBlockScalar(lines, i + 1, baseIndent, blockScalar);
			result[key] = blk.value;
			i = blk.nextLine;
		} else {
			// Value on next lines (nested)
			i++;
			while (i < lines.length && isBlankOrComment(lines[i])) i++;
			if (i < lines.length) {
				const nextIndent = getIndent(lines[i]);
				if (nextIndent > baseIndent) {
					const sub = parseYamlValue(lines, i, depth + 1);
					result[key] = sub.value;
					i = sub.nextLine;
				} else {
					result[key] = null;
				}
			}
		}
	}

	return { value: result, nextLine: i };
}

function parseKeyValue(s: string): { key: string; val: unknown | undefined; blockScalar?: "|" | ">" } {
	const colonIdx = s.indexOf(":");
	if (colonIdx === -1) return { key: s.trim(), val: undefined };
	const key = s.slice(0, colonIdx).trim();
	const rest = s.slice(colonIdx + 1).trim();
	if (rest === "") return { key, val: undefined };
	if (rest === "|" || rest === "|-" || rest === "|+") return { key, val: undefined, blockScalar: "|" };
	if (rest === ">" || rest === ">-" || rest === ">+") return { key, val: undefined, blockScalar: ">" };
	return { key, val: parseScalar(rest) };
}

function readBlockScalar(lines: string[], startLine: number, baseIndent: number, style: "|" | ">"): { value: string; nextLine: number } {
	// Find first non-blank line at indent > baseIndent; that sets blockIndent
	let i = startLine;
	let blockIndent = -1;
	const collected: string[] = [];
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === "") { collected.push(""); i++; continue; }
		const ind = getIndent(line);
		if (ind <= baseIndent) break;
		if (blockIndent === -1) blockIndent = ind;
		if (ind < blockIndent) break;
		collected.push(line.slice(blockIndent));
		i++;
	}
	// Trim trailing empty lines
	while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
	if (style === "|") {
		return { value: collected.join("\n") + "\n", nextLine: i };
	} else {
		// folded: join consecutive non-empty lines with space, keep empty as newline
		const out: string[] = [];
		let buf = "";
		for (const l of collected) {
			if (l === "") {
				if (buf) { out.push(buf); buf = ""; }
				out.push("");
			} else {
				buf = buf ? buf + " " + l : l;
			}
		}
		if (buf) out.push(buf);
		return { value: out.join("\n") + "\n", nextLine: i };
	}
}

function parseScalar(s: string): unknown {
	if (s === "true") return true;
	if (s === "false") return false;
	if (s === "null" || s === "~") return null;
	// Quoted string
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	// Number
	const n = Number(s);
	if (!isNaN(n) && s !== "") return n;
	// Inline JSON array/object (YAML flow style). Try JSON first; if that fails,
	// attempt a light YAML→JSON normalization for unquoted-key flow maps like
	// `{ default: true }` which are valid YAML but not JSON.
	if (s.startsWith("[") || s.startsWith("{")) {
		try { return JSON.parse(s); } catch { /* fall through */ }
		try {
			const normalized = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
			return JSON.parse(normalized);
		} catch { /* fall through */ }
	}
	return s;
}
