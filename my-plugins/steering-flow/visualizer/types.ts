import type { TapeValue, TransitionRecord } from "../types.js";

export interface VisualizerSurface {
	name: string;
	description: string;
	label?: string;
}

export interface VisualizerActionArgument {
	name: string;
	description: string;
}

export interface VisualizerAction {
	id: string;
	description: string;
	nextStateId: string;
	arguments: VisualizerActionArgument[];
	conditionSummary: string;
	conditionDetail: string;
	isDefault: boolean;
}

export interface VisualizerState {
	id: string;
	description: string;
	isEpsilon: boolean;
	actions: VisualizerAction[];
}

export interface VisualizerFsm {
	id: string;
	name: string;
	flowDir: string;
	taskDescription: string;
	sourceLabel: string;
	states: VisualizerState[];
	currentStateId?: string;
	tapePath?: string;
	tape: Record<string, TapeValue>;
	transitionLog: TransitionRecord[];
}

export interface VisualizerDocument {
	title: string;
	generatedAt: string;
	sourceMode: "session" | "file";
	sourceLabel: string;
	activeFsmId?: string;
	fsms: VisualizerFsm[];
	commands: VisualizerSurface[];
	tools: VisualizerSurface[];
}

export interface VisualizerArtifactOptions {
	cwd: string;
	sessionId: string;
	flowFile?: string;
	outputFile?: string;
}

export interface VisualizerArtifactResult {
	mode: "session" | "file";
	outputPath: string;
	sourceLabel: string;
	fsmCount: number;
}
