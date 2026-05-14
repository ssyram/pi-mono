import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BUILTINS_DIR = join(dirname(fileURLToPath(import.meta.url)), "builtins");

/** Script filename for the builtin helper. */
interface BuiltinDef {
	script: string;
}

const BUILTIN_DEFS: Record<string, BuiltinDef> = {
	"submit/required-fields": { script: "submit-required-fields.mjs" },
	"self-check/basic": { script: "self-check-basic.mjs" },
	"validate/non-empty-args": { script: "validate-non-empty-args.mjs" },
	"soft-review/claude": { script: "soft-review-claude.mjs" },
	"soft-review/pi": { script: "soft-review-pi.mjs" },
};

export const KNOWN_BUILTINS: ReadonlySet<string> = new Set(Object.keys(BUILTIN_DEFS));

/**
 * Returns true when `raw` is a condition object that uses the `builtin` sugar key.
 * Does not validate the name — call expandBuiltinCondition for full expansion.
 */
export function isBuiltinCondition(raw: Record<string, unknown>): boolean {
	return "builtin" in raw;
}

/**
 * Expands a `{ builtin, args? }` condition record into canonical
 * `{ cmd, args }` form. The builtin helper receives only the args you declare,
 * so pass `${$TAPE_FILE}` explicitly when the helper needs tape access.
 *
 * Throws a plain Error with a descriptive message on unknown names or bad args.
 * The caller (validateCondition) is responsible for wrapping this in a ParseError.
 */
export function expandBuiltinCondition(
	raw: Record<string, unknown>,
	actionId: string,
	stateId: string,
): Record<string, unknown> {
	const name = raw["builtin"];
	if (typeof name !== "string" || name.trim().length === 0) {
		throw new Error(
			`Action '${actionId}' in state '${stateId}': builtin name must be a non-empty string (got ${JSON.stringify(name)})`,
		);
	}

	const def = BUILTIN_DEFS[name];
	if (def === undefined) {
		throw new Error(
			`Action '${actionId}' in state '${stateId}': unknown builtin '${name}'. Known builtins: ${[...KNOWN_BUILTINS].join(", ")}`,
		);
	}

	const userArgs = raw["args"];
	let expandedArgs: string[];
	if (userArgs === undefined) {
		expandedArgs = [join(BUILTINS_DIR, def.script)];
	} else if (Array.isArray(userArgs) && userArgs.every((a) => typeof a === "string")) {
		expandedArgs = [join(BUILTINS_DIR, def.script), ...(userArgs as string[])];
	} else {
		throw new Error(
			`Action '${actionId}' in state '${stateId}': builtin '${name}' args must be an array of strings`,
		);
	}

	const extra = Object.keys(raw).filter((k) => k !== "builtin" && k !== "args");
	if (extra.length > 0) {
		throw new Error(
			`Action '${actionId}' in state '${stateId}': builtin condition has unexpected keys: ${extra.join(", ")}`,
		);
	}

	return { cmd: "node", args: expandedArgs };
}
