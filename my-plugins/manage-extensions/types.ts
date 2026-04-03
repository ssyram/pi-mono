import type { ExtensionState } from "./resolve-state.js";

export type Pending = Map<string, { local: boolean; global: boolean }>;

export type Focus = "list" | "actions";

export type ActionId = "apply" | "list" | "cancel";

export type ListResult =
	| { action: "cancel" }
	| { action: "apply" }
	| { action: "back" };

export type KeyMap = {
	cancel: (data: string) => boolean;
	confirm: (data: string) => boolean;
	up: (data: string) => boolean;
	down: (data: string) => boolean;
	left: (data: string) => boolean;
	right: (data: string) => boolean;
	tab: (data: string) => boolean;
	shiftTab: (data: string) => boolean;
	space: (data: string) => boolean;
};

// Re-export for consumers that import ExtensionState alongside these types
export type { ExtensionState };
