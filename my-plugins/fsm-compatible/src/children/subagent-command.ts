import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { NATIVE_THINKING_LEVELS } from "./native-child-record.ts";

export interface FleetIntelRow {
	sessionId: string;
	name: string | null;
	parentSessionId: string | null;
	sessionFile: string;
	state: string;
	model: string;
	thinking: string;
	outcome: string | null;
	runActive: boolean;
	fsmName: string;
	fsmState: string;
	noProgress: number;
}

export interface SubagentCommandDeps {
	/** Enqueue a dispatch entry so the launched child consumes it at actor acquire. */
	dispatch(fsmName: string): Promise<void>;
	/** Launch through the native coordinator admission path; resolves to the child session id. */
	launch(input: { description: string; prompt: string; subagent_type: string; name?: string; extraArgs?: string[] }, model: string, thinking: string): Promise<{ session_id: string }>;
	/** Full intel rows (current + past children) for /subagent find. */
	intel(): Promise<readonly FleetIntelRow[]>;
	/** Deliver a message to the root transcript (child-side send-to-main). */
	sendToMain?(message: string): Promise<void>;
	hostAgentName(): string;
	defaultModel(): string | undefined;
	defaultThinking(): string | undefined;
}

export interface SubagentSendRequest {
	prompt: string;
	fsmName: string;
	model: string | undefined;
	thinking: string | undefined;
	name: string | undefined;
	extraArgs: string[];
}

const RESERVED_FLAGS = new Set(["--session", "--mode", "-s", "-m"]);

export function parseSubagentSend(raw: string): SubagentSendRequest | { error: string } {
	const text = raw.trim();
	if (!text.startsWith("send")) return { error: "usage: /subagent send \"prompt\" --fsm <skill> [--model provider/model:thinking] [--name label] [-- pi flags]" };
	let rest = text.slice(4).trim();
	let prompt: string | undefined;
	if (rest.startsWith('"') || rest.startsWith("'")) {
		const quote = rest[0]!;
		const end = rest.indexOf(quote, 1);
		if (end < 0) return { error: "unterminated prompt quote" };
		prompt = rest.slice(1, end);
		rest = rest.slice(end + 1).trim();
	} else {
		const space = rest.search(/\s--/);
		const stop = space < 0 ? rest.length : space;
		prompt = rest.slice(0, stop);
		rest = rest.slice(stop).trim();
	}
	if (!prompt) return { error: "empty prompt" };
	let fsmName: string | undefined, model: string | undefined, thinking: string | undefined, name: string | undefined;
	const extraArgs: string[] = [];
	const tokens = rest.length ? rest.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/) : [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!;
		if (token === "--") { extraArgs.push(...tokens.slice(index + 1)); break; }
		if (token === "--fsm" || token === "--model" || token === "--name") {
			const value = tokens[++index];
			if (value === undefined) return { error: `${token} requires a value` };
			if (token === "--fsm") fsmName = strip(value);
			else if (token === "--name") name = strip(value);
			else {
				const parsed = parseModelRef(strip(value));
				if (typeof parsed === "string") return { error: parsed };
				model = parsed.model; thinking = parsed.thinking;
			}
			continue;
		}
		return { error: `unknown token ${token}` };
	}
	if (!fsmName) return { error: "--fsm <skill-name> is required so the child consumes a real dispatch entry" };
	const clash = extraArgs.find((arg) => RESERVED_FLAGS.has(arg));
	if (clash) return { error: `${clash} is owned by the coordinator and cannot be overridden` };
	const filtered: string[] = [];
	for (let index = 0; index < extraArgs.length; index++) {
		const arg = extraArgs[index]!;
		if (arg === "--model" || arg === "--thinking") { index++; continue; }
		filtered.push(arg);
	}
	return { prompt, fsmName, model, thinking, name, extraArgs: filtered };
}

function strip(value: string): string {
	return value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value;
}

export function parseModelRef(ref: string): { model: string; thinking: string | undefined } | string {
	const colon = ref.lastIndexOf(":");
	if (colon > 0) {
		const thinking = ref.slice(colon + 1);
		if (!NATIVE_THINKING_LEVELS.includes(thinking)) return `unknown thinking level ${thinking}; expected one of ${NATIVE_THINKING_LEVELS.join("/")}`;
		return { model: ref.slice(0, colon), thinking };
	}
	return { model: ref, thinking: undefined };
}

function intelLine(row: FleetIntelRow): string {
	const fsm = `${row.fsmName}:${row.fsmState}${row.noProgress > 0 ? ` (no-progress ${row.noProgress})` : ""}`;
	return `${row.name ?? "agent"} ${row.sessionId} [${fsm}] ${row.runActive ? "busy" : row.state}${row.outcome ? ` ${row.outcome}` : ""} ${row.model} ${row.sessionFile ? `file:${row.sessionFile}` : "file:-"}`;
}

export function registerSubagentCommand(pi: ExtensionAPI, _ctx: ExtensionContext, deps: SubagentCommandDeps): () => void {
	const handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const trimmed = args.trim();
		if (trimmed === "find --all" || trimmed === "find") {
			const rows = await deps.intel();
			if (rows.length === 0) { ctx.ui.notify("no subagent runs recorded", "info"); return; }
			for (const row of rows) ctx.ui.notify(intelLine(row), "info");
			return;
		}
		if (trimmed.startsWith("transcript")) {
			const target = trimmed.slice("transcript".length).trim();
			if (!target) { ctx.ui.notify("usage: /subagent transcript <session-id|name>", "error"); return; }
			const rows = await deps.intel();
			const row = rows.find((item) => item.sessionId === target || item.name === target);
			if (!row) { ctx.ui.notify(`no subagent run matches ${target}`, "error"); return; }
			ctx.ui.notify(row.sessionFile ? `transcript: ${row.sessionFile}` : `${row.sessionId} has no transcript file (state ${row.state})`, "info");
			return;
		}
		if (deps.sendToMain && trimmed.startsWith("send-to-main")) {
			const message = trimmed.slice("send-to-main".length).trim();
			if (!message) { ctx.ui.notify("usage: /subagent send-to-main <message>", "error"); return; }
			await deps.sendToMain(message.startsWith('"') && message.endsWith('"') ? message.slice(1, -1) : message);
			ctx.ui.notify("sent to main", "info");
			return;
		}
		const parsed = parseSubagentSend(args);
		if ("error" in parsed) { ctx.ui.notify(parsed.error, "error"); return; }
		try {
			await deps.dispatch(parsed.fsmName!);
			const model = parsed.model ?? deps.defaultModel();
			const thinking = parsed.thinking ?? deps.defaultThinking();
			if (!model || !thinking) { ctx.ui.notify("no model selected; pass --model provider/model:thinking", "error"); return; }
			const launched = await deps.launch({ description: "manual /subagent launch", prompt: parsed.prompt, subagent_type: deps.hostAgentName(),
				...(parsed.name ? { name: parsed.name } : {}), ...(parsed.extraArgs.length ? { extraArgs: parsed.extraArgs } : {}) }, model, thinking);
			ctx.ui.notify(`subagent ${launched.session_id} launched (${model} · ${thinking}); press ↓ with an empty editor to open the fleet view`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "unknown";
			const hint = /oc-http-403|authorization failed/.test(message)
				? `${message} — the root session must be in an FSM state that permits Agent; enter_fsm first`
				: message;
			ctx.ui.notify(`subagent launch failed: ${hint}`, "error");
		}
	};
	pi.registerCommand("subagent", { description: "subagent ops: send \"prompt\" --fsm <skill> | find [--all] | transcript <id> | send-to-main <msg>",
		handler });
	return () => {};
}
