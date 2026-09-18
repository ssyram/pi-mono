import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Task } from "../task-types.js";

export interface TaskRecord extends Task {
	closedOrder?: number;
}
export interface TaskState {
	tasks: TaskRecord[];
	nextId: number;
}
export type TaskListType =
	| "open"
	| "closed"
	| "in_progress"
	| "ready"
	| "blocked"
	| "done"
	| "expired";
export interface TaskCreation {
	key?: string;
	text?: string;
	start?: boolean;
	blockedBy?: (number | string)[];
}
export type TaskRequest =
	| { action: "list"; type?: TaskListType; limit?: number }
	| { action: "add"; text: string; start?: boolean; blockedBy?: number[] }
	| { action: "add"; tasks: TaskCreation[] }
	| { action: "start"; id: number }
	| { action: "done"; id: number }
	| { action: "expire"; id: number; reason: string }
	| {
			action: "update_deps";
			id: number;
			blocks?: number[];
			blockedBy?: number[];
	  };
export interface TaskOutcome {
	kind:
		| "created"
		| "skipped_item"
		| "edge_added"
		| "edge_skipped"
		| "started"
		| "start_skipped"
		| "blocked";
	item?: number;
	id?: number;
	key?: string;
	message: string;
}
export interface TaskRow {
	task: TaskRecord;
	status: "in_progress" | "ready" | "blocked" | "done" | "expired";
	blockers: number[];
}
export interface TaskResultDetails {
	action: TaskRequest["action"] | "clear" | "modify" | "error";
	tasks: TaskRecord[];
	rows: TaskRow[];
	nextId: number;
	outcomes: TaskOutcome[];
	partial: boolean;
	error?: string;
}
export interface TaskOperation {
	state: TaskState;
	changed: boolean;
	result: AgentToolResult<TaskResultDetails>;
}
export function cloneTaskState(state: TaskState): TaskState {
	return {
		nextId: state.nextId,
		tasks: state.tasks.map((task) => ({
			...task,
			blocks: [...task.blocks],
			blockedBy: [...task.blockedBy],
		})),
	};
}
