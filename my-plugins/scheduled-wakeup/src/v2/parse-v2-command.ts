import { parseAtTime } from "../parse-at-time.js";
import { parseDuration } from "../parse-duration.js";
import type { SharedScope, TaskSchedule } from "./model.js";

export type ParsedLoopV2Command =
	| { kind: "add"; schedule: TaskSchedule; prompt: string }
	| { kind: "define"; scope: SharedScope; schedule: TaskSchedule; prompt: string }
	| { kind: "available"; scopes: readonly SharedScope[] }
	| { kind: "register"; scope: SharedScope; definitionId: string }
	| { kind: "unregister"; registrationId: string }
	| { kind: "list" }
	| { kind: "stop"; target: string }
	| { kind: "delete"; scope: SharedScope; definitionId: string; force: boolean }
	| { kind: "run"; id: string }
	| { kind: "help" }
	| { kind: "error"; message: string };

export function parseLoopV2Command(args: string, now: number = Date.now()): ParsedLoopV2Command {
	const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0);
	const head = tokens[0];
	if (head === undefined || head === "help") return { kind: "help" };
	const rest = tokens.slice(1);
	switch (head) {
		case "add":
			return parseAdd(rest, now);
		case "define":
			return parseDefine(rest, now);
		case "available":
			return parseAvailable(rest);
		case "register":
			return parseRegister(rest);
		case "unregister":
			return parseUnregister(rest);
		case "list":
			return rest.length === 0 ? { kind: "list" } : { kind: "error", message: "Usage: /loop list" };
		case "stop":
			return parseStop(rest);
		case "delete":
			return parseDelete(rest);
		case "run":
			return parseRun(rest);
		default:
			return { kind: "error", message: `Unknown command "${head}". Run /loop help.` };
	}
}

export function loopV2HelpText(): string {
	return [
		"Usage:",
		"/loop add <interval> <prompt...>              Session recurring task",
		"/loop add once <delay> <prompt...>            Session one-shot task",
		"/loop add at <time...> -- <prompt...>         Session one-shot at a clock time",
		"/loop define <ws|workspace|global> <forms>    Shared definition (same forms as add)",
		"/loop available [ws|workspace|global]         Unregistered shared definitions",
		"/loop register <ws|workspace|global> <id>     Register a shared definition",
		"/loop unregister <registration-id>            Remove this session's registration",
		"/loop list                                    Show this session's active set",
		"/loop stop <id|all>                           Stop active tasks and registrations",
		"/loop delete [--force] <definition-id>        Delete a shared definition (scope from id prefix)",
		"/loop run <id>                                Deliver the prompt now, progress unchanged",
		"/loop help                                    Show this help",
		"Durations: 10s, 5m, 2h, 1d. Times: 12am tomorrow, 09:30 +08:00, 2026-08-05T00:00:00Z.",
	].join("\n");
}

function parseAdd(tokens: string[], now: number): ParsedLoopV2Command {
	const head = tokens[0];
	if (head === "once") return parseOnce(tokens.slice(1), now);
	if (head === "at") return parseAt(tokens.slice(1), now);
	if (head === undefined) return usageAdd();
	const [intervalText, promptTokens] = takeFirst(tokens);
	const intervalMs = intervalText === undefined ? undefined : parseDuration(intervalText);
	if (intervalMs === undefined) return usageAdd();
	return withPrompt({ kind: "interval", intervalMs }, joinPrompt(promptTokens));
}

function parseOnce(tokens: string[], now: number): ParsedLoopV2Command {
	const [delayText, promptTokens] = takeFirst(tokens);
	const delayMs = delayText === undefined ? undefined : parseDuration(delayText);
	if (delayMs === undefined) return usageAdd();
	return withPrompt({ kind: "once", runAt: now + delayMs }, joinPrompt(promptTokens));
}

function parseAt(tokens: string[], now: number): ParsedLoopV2Command {
	const separator = tokens.indexOf("--");
	if (separator === -1) return usageAdd();
	const expression = tokens.slice(0, separator).join(" ").trim();
	if (expression.length === 0) return usageAdd();
	const runAt = parseAtTime(expression, new Date(now));
	if (runAt === undefined) {
		return { kind: "error", message: `Invalid or past time "${expression}". Examples: 12am tomorrow, 09:30 +08:00, 2026-08-05T00:00:00Z.` };
	}
	return withPrompt({ kind: "once", runAt }, joinPrompt(tokens.slice(separator + 1)));
}

function parseDefine(tokens: string[], now: number): ParsedLoopV2Command {
	const scope = parseScope(tokens[0]);
	if (scope === undefined) {
		return { kind: "error", message: "Usage: /loop define <ws|workspace|global> <interval> <prompt...> | once <delay> <prompt...> | at <time...> -- <prompt...>" };
	}
	const parsed = parseAdd(tokens.slice(1), now);
	return parsed.kind === "add" ? { kind: "define", scope, schedule: parsed.schedule, prompt: parsed.prompt } : parsed;
}

function parseAvailable(tokens: string[]): ParsedLoopV2Command {
	if (tokens.length === 0) return { kind: "available", scopes: ["workspace", "global"] };
	const scope = tokens.length === 1 ? parseScope(tokens[0]) : undefined;
	return scope !== undefined ? { kind: "available", scopes: [scope] } : { kind: "error", message: "Usage: /loop available [ws|workspace|global]" };
}

function parseRegister(tokens: string[]): ParsedLoopV2Command {
	const scope = parseScope(tokens[0]);
	const definitionId = joinPrompt(tokens.slice(1));
	if (scope === undefined || definitionId.length === 0) {
		return { kind: "error", message: "Usage: /loop register <ws|workspace|global> <definition-id>" };
	}
	return { kind: "register", scope, definitionId };
}

function parseUnregister(tokens: string[]): ParsedLoopV2Command {
	const registrationId = joinPrompt(tokens);
	return registrationId.length > 0
		? { kind: "unregister", registrationId }
		: { kind: "error", message: "Usage: /loop unregister <registration-id>" };
}

function parseStop(tokens: string[]): ParsedLoopV2Command {
	const target = joinPrompt(tokens);
	return target.length > 0 ? { kind: "stop", target } : { kind: "error", message: "Usage: /loop stop <id|all>" };
}

function parseRun(tokens: string[]): ParsedLoopV2Command {
	const id = joinPrompt(tokens);
	return id.length > 0 ? { kind: "run", id } : { kind: "error", message: "Usage: /loop run <id>" };
}

function parseDelete(tokens: string[]): ParsedLoopV2Command {
	const force = tokens.includes("--force");
	const ids = tokens.filter((token) => token !== "--force");
	const id = ids.length === 1 ? ids[0] : undefined;
	const scope = id === undefined ? undefined : parseScope(id.split(":", 1)[0]);
	if (id === undefined || scope === undefined) {
		return { kind: "error", message: 'Usage: /loop delete [--force] <definition-id> where the id starts with "workspace:" or "global:".' };
	}
	return { kind: "delete", scope, definitionId: id, force };
}

function withPrompt(schedule: TaskSchedule, prompt: string): ParsedLoopV2Command {
	return prompt.length > 0
		? { kind: "add", schedule, prompt }
		: { kind: "error", message: "Prompt must contain at least one non-empty token." };
}

function usageAdd(): ParsedLoopV2Command {
	return { kind: "error", message: "Usage: /loop add <interval> <prompt...> | /loop add once <delay> <prompt...> | /loop add at <time...> -- <prompt...>" };
}

function parseScope(value: string | undefined): SharedScope | undefined {
	if (value === "ws" || value === "workspace") return "workspace";
	return value === "global" ? "global" : undefined;
}

function takeFirst(tokens: string[]): [string | undefined, string[]] {
	const first = tokens[0];
	return [first, tokens.slice(1)];
}

function joinPrompt(tokens: string[]): string {
	return tokens.join(" ").trim();
}
