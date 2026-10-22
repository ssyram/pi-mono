import { parseAtTime } from "../parse-at-time.js";
import { parseDuration } from "../parse-duration.js";
import type { SharedScope } from "./model.js";
import { parseTaskCommand, type TaskCreationCommand } from "./parse-task-command.js";
import type { DeferTime } from "./defer-active-task.js";

export type ParsedLoopV2Command =
	| TaskCreationCommand
	| { kind: "available"; scopes: readonly SharedScope[] }
	| { kind: "register"; scope: SharedScope; definitionId: string }
	| { kind: "unregister"; registrationId: string }
	| { kind: "list" }
	| { kind: "running" }
	| { kind: "show"; visible: boolean }
	| { kind: "stop"; target: string }
	| { kind: "delete"; scope: SharedScope; definitionId: string; force: boolean }
	| { kind: "run"; id: string }
	| { kind: "defer"; id: string; time: DeferTime }
	| { kind: "help" }
	| { kind: "error"; message: string };

export function parseLoopV2Command(args: string, now: number = Date.now(), baseCwd?: string): ParsedLoopV2Command {
	const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0);
	const head = tokens[0];
	if (head === undefined || head === "help") return { kind: "help" };
	const rest = tokens.slice(1);
	switch (head) {
		case "add":
		case "define":
			return parseTaskCommand(head, args.trim().slice(head.length), now, baseCwd);
		case "available":
			return parseAvailable(rest);
		case "register":
			return parseRegister(rest);
		case "unregister":
			return parseUnregister(rest);
		case "show":
			return rest.length === 1 && (rest[0] === "on" || rest[0] === "off")
				? { kind: "show", visible: rest[0] === "on" } : { kind: "error", message: "Usage: /loop show off|on" };
		case "running":
			return rest.length === 0 ? { kind: "running" } : { kind: "error", message: "Usage: /loop running" };
		case "list":
			return rest.length === 0 ? { kind: "list" } : { kind: "error", message: "Usage: /loop list" };
		case "stop":
			return parseStop(rest);
		case "delete":
			return parseDelete(rest);
		case "run":
			return parseRun(rest);
		case "defer":
			return parseDefer(rest, now);
		default:
			return { kind: "error", message: `Unknown command "${head}". Run /loop help.` };
	}
}

export function loopV2HelpText(): string {
	return [
		"Usage:",
		"/loop running                               Toggle widget details (fullscreen only)",
		"/loop show off|on                            Hide/show widget for this session; never stops tasks",
		'Script options before schedule: --script {"path":"./check.sh"} (repeatable), --wake always|on-error|never, --error-mode or|and.',
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
		"/loop defer <id> <duration|time...>            Postpone only the next scheduled delivery",
		"Defer durations extend max(now, next run); absolute times must be later than both.",
		"--no-boulder may precede the schedule/prompt; it inhibits Boulder for the schedule's active lifetime.",
		"/loop help                                    Show this help",
		"Durations: 10s, 10sec, 5m, 10min, 2h, 1d. Times: 12am tomorrow, 09:30 +08:00, 2026-08-05T00:00:00Z.",
	].join("\n");
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

function parseDefer(tokens: string[], now: number): ParsedLoopV2Command {
	const id = tokens[0];
	const expression = tokens.slice(1).join(" ");
	if (id === undefined || expression.length === 0) return { kind: "error", message: "Usage: /loop defer <id> <duration|time...>" };
	const delayMs = parseDuration(expression);
	if (delayMs !== undefined) return { kind: "defer", id, time: { kind: "delay", delayMs } };
	const runAt = parseAtTime(expression, new Date(now));
	return runAt === undefined
		? { kind: "error", message: `Invalid duration or future time "${expression}". Examples: 10m, 12am tomorrow, 2099-01-01T00:00:00Z.` }
		: { kind: "defer", id, time: { kind: "at", runAt } };
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

function parseScope(value: string | undefined): SharedScope | undefined {
	if (value === "ws" || value === "workspace") return "workspace";
	return value === "global" ? "global" : undefined;
}

function joinPrompt(tokens: string[]): string {
	return tokens.join(" ").trim();
}
