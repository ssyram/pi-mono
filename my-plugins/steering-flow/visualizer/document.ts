import { basename } from "node:path";
import { buildFSM, parseFlowConfig } from "../parser.js";
import { loadRuntime, readStack, tapePathFor } from "../storage.js";
import type { TapeValue, TransitionRecord } from "../types.js";
import { toVisualizerState } from "./normalize-state.js";
import type { VisualizerDocument, VisualizerFsm, VisualizerSurface } from "./types.js";

const COMMANDS: VisualizerSurface[] = [
	{ name: "/load-steering-flow <FILE>", description: "Load a flow config and push it onto the FSM stack." },
	{ name: "/pop-steering-flow", description: "Pop the active FSM from the stack. User-only escape hatch." },
	{ name: "/save-to-steering-flow <ID> <VALUE>", description: "Write a value to the active FSM tape." },
	{ name: "/get-steering-flow-info", description: "Print stack, state, tape, and active actions." },
	{ name: "/steering-flow-action <ACTION-ID> [ARGS...]", description: "Invoke an action on the active FSM." },
	{ name: "/visualize-steering-flow [FLOW_FILE] [-o OUTPUT.html]", description: "Generate this static HTML visualizer." },
];

const TOOLS: VisualizerSurface[] = [
	{ name: "load-steering-flow", description: "LLM tool for loading a flow config." },
	{ name: "steering-flow-action", description: "LLM tool for invoking an action with positional args." },
	{ name: "save-to-steering-flow", description: "LLM tool for writing tape values." },
	{ name: "get-steering-flow-info", description: "LLM tool for inspecting active flow state." },
	{ name: "visualize-steering-flow", description: "LLM tool for generating a static visualizer artifact." },
];

export function getVisualizerCommands(): VisualizerSurface[] {
	return COMMANDS;
}

export function getVisualizerTools(): VisualizerSurface[] {
	return TOOLS;
}

export async function buildSessionVisualizerDocument(sessionDir: string, sessionId: string): Promise<{ document: VisualizerDocument; warnings: string[] }> {
	const stack = await readStack(sessionDir);
	if (stack.length === 0) throw new Error("No active steering-flow stack to visualize.");

	const warnings: string[] = [];
	const fsms: VisualizerFsm[] = [];
	for (const fsmId of stack) {
		const runtime = await loadRuntime(sessionDir, fsmId);
		if (!runtime) {
			warnings.push(`[steering-flow] Warning: FSM "${fsmId}" could not be loaded and will be skipped in the visualization.`);
			continue;
		}
		fsms.push({
			id: runtime.fsm_id,
			name: runtime.flow_name,
			flowDir: runtime.flow_dir,
			taskDescription: runtime.task_description,
			sourceLabel: runtime.flow_name,
			states: (() => {
				const s = Object.values(runtime.states).map(toVisualizerState);
				if (s.length === 0) warnings.push(`[steering-flow] Warning: FSM "${runtime.fsm_id}" (${runtime.flow_name}) has no states — the visualization will be empty.`);
				return s;
			})(),
			currentStateId: runtime.current_state_id,
			tapePath: tapePathFor(sessionDir, fsmId),
			tape: runtime.tape,
			transitionLog: runtime.transition_log,
		});
	}
	if (fsms.length === 0) throw new Error("No readable steering-flow FSMs found in the active stack.");

	return {
		document: {
			title: `Steering-Flow · ${sessionId || "session"}`,
			generatedAt: new Date().toISOString(),
			sourceMode: "session",
			sourceLabel: sessionId || "_no_session_",
			activeFsmId: stack.at(-1),
			fsms,
			commands: COMMANDS,
			tools: TOOLS,
		},
		warnings,
	};
}

export function buildFileVisualizerDocument(content: string, filename: string): { document: VisualizerDocument; warnings: string[] } {
	const warnings: string[] = [];
	const flow = parseFlowConfig(content, filename);
	const parsed = buildFSM(flow);
	const states = Array.from(parsed.states.values());
	if (states.length === 0) warnings.push(`[steering-flow] Warning: FSM file "${filename}" has no states — the visualization will be empty.`);
	const name = basename(filename);
	const emptyTape: Record<string, TapeValue> = {};
	const transitionLog: TransitionRecord[] = [];

	return {
		document: {
			title: `Steering-Flow · ${name}`,
			generatedAt: new Date().toISOString(),
			sourceMode: "file",
			sourceLabel: filename,
			fsms: [
				{
					id: name,
					name,
					flowDir: "",
					taskDescription: flow.task_description,
					sourceLabel: filename,
					states: states.map(toVisualizerState),
					currentStateId: "$START",
					tape: emptyTape,
					transitionLog,
				},
			],
			commands: COMMANDS,
			tools: TOOLS,
		},
		warnings,
	};
}
