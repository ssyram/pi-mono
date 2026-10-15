import { type ParsedArg, parseArg, parseArgs } from "./setting-command-args.ts";

export type SettingScopeFlag = "global" | "local" | "session";

export interface CommandPaths {
	globalFile?: string;
	localFile?: string;
}

export type ParsedSettingCommand =
	| { kind: "help" }
	| {
			kind: "set";
			scopes: SettingScopeFlag[];
			paths: CommandPaths;
			key: string;
			valueText: string;
	  }
	| { kind: "get"; paths: CommandPaths; keys: string[] }
	| {
			kind: "unset";
			scopes: SettingScopeFlag[];
			paths: CommandPaths;
			keys: string[];
	  }
	| { kind: "error"; message: string };

export const MY_SETTING_HELP = [
	"/my-setting — manual e2e surface for the my-settings service (no model tool).",
	"  set [--global] [--local] [--session] [--global-file P] [--local-file P] KEY VAL",
	'      VAL is parsed strictly as a JSON value: true is boolean, "true" (quoted) is string.',
	"      Scope flags are ONLY saves, executed global → local → session when combined;",
	'      KEY may be quoted as a JSON string ("my key") to contain whitespace or start with --.',
	"  get [--global-file P] [--local-file P] KEY...",
	"      Shows per-layer raw values (global/local/session) and the service-merged result.",
	"  unset [--global] [--local] [--session] [--global-file P] [--local-file P] KEY...",
	"      Removes keys: real deletion in global/local files; a tombstone in the session log",
	"      that cancels this session's overlay (lower layers show through again).",
].join("\n");

interface FlagScan {
	scopes: SettingScopeFlag[];
	paths: CommandPaths;
	restStart: number;
	error?: string;
}

function scanFlags(body: string, allowScopes: boolean): FlagScan {
	const scopes: SettingScopeFlag[] = [];
	const paths: CommandPaths = {};
	const matches = [...body.matchAll(/\S+/g)];
	let restStart = body.length;
	for (let index = 0; index < matches.length; index++) {
		const token = matches[index][0];
		if (token === "--session" && !scopes.includes("session")) {
			scopes.push("session");
			continue;
		}
		if (allowScopes && token === "--global" && !scopes.includes("global")) {
			scopes.push("global");
			continue;
		}
		if (allowScopes && token === "--local" && !scopes.includes("local")) {
			scopes.push("local");
			continue;
		}
		if (token === "--global-file" || token === "--local-file") {
			const next = matches[index + 1];
			if (!next || next[0].startsWith("--") || next[0].startsWith('"')) {
				return {
					scopes,
					paths,
					restStart,
					error: `${token} requires a bare path argument`,
				};
			}
			paths[token === "--global-file" ? "globalFile" : "localFile"] = next[0];
			index++;
			continue;
		}
		restStart = matches[index].index ?? 0;
		break;
	}
	return { scopes, paths, restStart };
}

function rejectFlagTokens(sub: string, args: ParsedArg[]): string | undefined {
	const scopeFlag = args.find(
		(arg) => !arg.quoted && (arg.value === "--global" || arg.value === "--local" || arg.value === "--session"),
	);
	if (scopeFlag) return `${sub} takes no scope flags; it shows all layers`;
	const unknown = args.find((arg) => !arg.quoted && arg.value.startsWith("--"));
	if (unknown) return `${sub} Unknown flag: ${unknown.value}`;
	return undefined;
}

function sortedScopes(scopes: SettingScopeFlag[]): SettingScopeFlag[] {
	const order: Record<string, number> = { global: 0, local: 1, session: 2 };
	return [...scopes].sort((left, right) => order[left] - order[right]);
}

export function parseSettingCommand(args: string): ParsedSettingCommand {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || tokens[0] === "help") return { kind: "help" };
	const sub = tokens[0];
	const body = args.trim().slice(sub.length).trim();
	if (sub === "set") {
		const scan = scanFlags(body, true);
		if (scan.error) return { kind: "error", message: scan.error };
		if (scan.scopes.length === 0)
			return {
				kind: "error",
				message: "set requires at least one of --global/--local/--session",
			};
		if (scan.restStart >= body.length) return { kind: "error", message: "set requires KEY VAL" };
		const outcome = parseArg(body, scan.restStart);
		if (!outcome.ok) return { kind: "error", message: outcome.message };
		const { value: key, quoted, end } = outcome.arg;
		if (quoted && end < body.length && !/\s/.test(body[end])) {
			return {
				kind: "error",
				message: `KEY 引号后必须跟空白：${body.slice(scan.restStart, end + 1)}`,
			};
		}
		if (!quoted && key.startsWith("--")) return { kind: "error", message: "set requires KEY VAL" };
		const valueText = body.slice(end).trim();
		if (!valueText) return { kind: "error", message: "set requires KEY VAL" };
		return {
			kind: "set",
			scopes: sortedScopes(scan.scopes),
			paths: scan.paths,
			key,
			valueText,
		};
	}
	if (sub === "get" || sub === "unset") {
		const allowScopes = sub === "unset";
		const scan = scanFlags(body, allowScopes);
		if (scan.error) return { kind: "error", message: scan.error };
		if (sub === "get" && scan.scopes.length > 0) {
			return {
				kind: "error",
				message: "get takes no scope flags; it shows all layers",
			};
		}
		if (sub === "unset" && scan.scopes.length === 0) {
			return {
				kind: "error",
				message: "unset requires at least one of --global/--local/--session",
			};
		}
		const parsed = parseArgs(body, scan.restStart);
		if (!parsed.ok) return { kind: "error", message: parsed.message };
		const rejection = rejectFlagTokens(sub, parsed.args);
		if (rejection) return { kind: "error", message: rejection };
		if (parsed.args.length === 0) return { kind: "error", message: `${sub} requires at least one KEY` };
		const keys = parsed.args.map((arg) => arg.value);
		if (sub === "get") return { kind: "get", paths: scan.paths, keys };
		return {
			kind: "unset",
			scopes: sortedScopes(scan.scopes),
			paths: scan.paths,
			keys,
		};
	}
	return { kind: "error", message: `Unknown subcommand: ${sub}` };
}
