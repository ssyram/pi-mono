import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { createVisualizerArtifact } from "./visualizer/index.js";
import { renderNotifyInfo } from "./notify-render.js";

type CoreCalls = {
	load: (path: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
	pop: () => Promise<string>;
	save: (id: string, value: string) => Promise<string>;
	contextInfo: () => Promise<string>;
	info: () => Promise<string>;
	setState: (stateId: string) => Promise<string>;
	setAction: (actionId: string, args: string[]) => Promise<string>;
	action: (actionId: string, args: string[]) => Promise<string>;
	visualize: (flowFile: string | undefined, outputFile: string | undefined) => Promise<Awaited<ReturnType<typeof createVisualizerArtifact>>>;
};

type SteeringFlowCommandOptions = {
	pi: ExtensionAPI;
	tokenizeArgs: (input: string) => string[];
	friendlyError: (error: unknown) => string;
	isReservedJsName: (name: string) => boolean;
	calls: (ctx: ExtensionCommandContext) => CoreCalls;
};

const HELP = `## /steering-flow

Usage: /steering-flow <subcommand> [args]

Subcommands:
- help | h | --help: show this help
- load <FILE>: load a flow config and send the state view to the model
- pop: pop the top FSM and send the resumed state to the model
- save <ID> <VALUE>: save a tape value via UI notification
- context-info: send stack/state/tape info to the model
- info: show stack/state/tape info as UI notification only
- set-state <STATE-ID>: user-only set/jump current state
- reset-state: user-only reset current state to $START
- set-action <ACTION-ID> [ARGS...]: user-only trigger action via UI notification
- action <ACTION-ID> [ARGS...]: trigger action and send result to the model
- visualize [FLOW_FILE] [-o OUTPUT.html]: generate a visualizer artifact as UI notification`;

function notifyHelp(ctx: ExtensionCommandContext): void {
	ctx.ui.notify(HELP, "info");
}

function parseVisualizerArgs(parts: string[]): { flowFile: string | undefined; outputFile: string | undefined } | { error: string } {
	let flowFile: string | undefined;
	let outputFile: string | undefined;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === "-o" || part === "--output") {
			outputFile = parts[i + 1];
			if (!outputFile) return { error: "Usage: /steering-flow visualize [FLOW_FILE] [-o OUTPUT.html]" };
			i++;
			continue;
		}
		if (flowFile !== undefined) return { error: "Usage: /steering-flow visualize [FLOW_FILE] [-o OUTPUT.html]" };
		flowFile = part;
	}
	return { flowFile, outputFile };
}

function parseTapeArgs(args: string): { id: string; value: string } | { error: string } {
	const trimmed = args.trim();
	const firstSpace = trimmed.indexOf(" ");
	if (firstSpace === -1) return { error: "Usage: /steering-flow save <ID> <VALUE>" };
	return { id: trimmed.slice(0, firstSpace), value: trimmed.slice(firstSpace + 1) };
}

function isHelp(subcommand: string | undefined): boolean {
	return subcommand === undefined || subcommand === "help" || subcommand === "h" || subcommand === "--help";
}

export function registerSteeringFlowCommand(options: SteeringFlowCommandOptions): void {
	const { pi, tokenizeArgs, friendlyError, isReservedJsName, calls } = options;
	pi.registerCommand("steering-flow", {
		description: "Steering Flow control: /steering-flow <subcommand> [args]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let parts: string[];
			try {
				parts = tokenizeArgs(args);
			} catch (error) {
				ctx.ui.notify(`${friendlyError(error)}. Showing /steering-flow help.`, "error");
				notifyHelp(ctx);
				return;
			}
			const [subcommand, ...rest] = parts;
			if (isHelp(subcommand)) { notifyHelp(ctx); return; }
			const core = calls(ctx);
			try {
				if (subcommand === "load") {
					const filePath = rest.join(" ").trim();
					if (!filePath) { ctx.ui.notify("Usage: /steering-flow load <FILE>", "error"); return; }
					const res = await core.load(filePath);
					if (!res.ok) { ctx.ui.notify(res.error, "error"); return; }
					pi.sendUserMessage(res.text);
					return;
				}
				if (subcommand === "pop") {
					// pop is a user-initiated stack op. Show the result in the UI but
					// do NOT inject it as a user message: the agent may still be
					// mid-turn (the runtime would then reject the queued message),
					// and a popped FSM has no continuation the agent needs to see.
					// If a parent FSM remains, the agent_end stop-hook will surface
					// its state on the next turn boundary.
					const text = await core.pop();
					ctx.ui.notify(text.split("\n")[0], "info");
					return;
				}
				if (subcommand === "save") {
					const parsed = parseTapeArgs(rest.join(" "));
					if ("error" in parsed) { ctx.ui.notify(parsed.error, "error"); return; }
					if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parsed.id)) { ctx.ui.notify(`Invalid tape id '${parsed.id}'.`, "error"); return; }
					if (isReservedJsName(parsed.id)) { ctx.ui.notify(`Tape id '${parsed.id}' is a reserved JS property name.`, "error"); return; }
					const text = await core.save(parsed.id, parsed.value);
					ctx.ui.notify(text.split("\n")[0], "info");
					return;
				}
				if (subcommand === "context-info") { pi.sendUserMessage(await core.contextInfo()); return; }
				if (subcommand === "info") { ctx.ui.notify(renderNotifyInfo(await core.info()), "info"); return; }
				if (subcommand === "set-state") {
					const stateId = rest.join(" ").trim();
					if (!stateId) { ctx.ui.notify("Usage: /steering-flow set-state <STATE-ID>", "error"); return; }
					ctx.ui.notify(renderNotifyInfo(await core.setState(stateId)), "info");
					return;
				}
				if (subcommand === "reset-state") { ctx.ui.notify(renderNotifyInfo(await core.setState("$START")), "info"); return; }
				if (subcommand === "set-action") {
					if (rest.length === 0) { ctx.ui.notify("Usage: /steering-flow set-action <ACTION-ID> [ARGS...]", "error"); return; }
					const [actionId, ...actionArgs] = rest;
					ctx.ui.notify(renderNotifyInfo(await core.setAction(actionId, actionArgs)), "info");
					return;
				}
				if (subcommand === "action") {
					if (rest.length === 0) { ctx.ui.notify("Usage: /steering-flow action <ACTION-ID> [ARGS...]", "error"); return; }
					const [actionId, ...actionArgs] = rest;
					pi.sendUserMessage(await core.action(actionId, actionArgs));
					return;
				}
				if (subcommand === "visualize") {
					const parsed = parseVisualizerArgs(rest);
					if ("error" in parsed) { ctx.ui.notify(parsed.error, "error"); return; }
					const result = await core.visualize(parsed.flowFile, parsed.outputFile);
					ctx.ui.notify(renderNotifyInfo(`## Steering-Flow Visualizer\n- Mode: ${result.mode}\n- FSM count: ${result.fsmCount}\n- Source: ${result.sourceLabel}\n- Output: ${result.outputPath}`), "info");
					for (const warning of result.warnings) ctx.ui.notify(warning, "warning");
					return;
				}
				ctx.ui.notify(`Unknown /steering-flow subcommand '${subcommand}'. Showing help.`, "error");
				notifyHelp(ctx);
			} catch (error) {
				ctx.ui.notify(friendlyError(error), "error");
			}
		},
	});
}
