import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface Task {
	id: number;
	text: string;
	expireReason?: string;
	status: "pending" | "in_progress" | "done" | "expired";
	blocks: number[];
	blockedBy: number[];
	createdAt: number;
	updatedAt: number;
}

export interface TaskDetails {
	action: "list" | "add" | "start" | "done" | "expire" | "clear" | "update_deps";
	tasks: Task[];
	nextId: number;
	error?: string;
}

export type TaskChangeCallback = (tasks: Task[], context: ExtensionContext) => void;
