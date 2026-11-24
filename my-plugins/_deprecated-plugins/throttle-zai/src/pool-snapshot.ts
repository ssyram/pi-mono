/** Wire-validated pool status shared internally by backend and usage modules. */

export interface BackendInfo {
	instanceId: string;
	controlUrl: string;
	relayBaseUrl: string;
}

export interface KeyWindow {
	usedPercent: number;
	resetAtMs?: number;
}

export interface KeyUsage {
	id: string;
	channelId: number;
	route: "enabled" | "disabled";
	tier: "active" | "standby" | "exhausted" | "unknown";
	fiveHour?: KeyWindow;
	weekly?: KeyWindow;
	query: "ok" | "failed";
}

export interface PoolSnapshot {
	info: BackendInfo;
	phase: "starting" | "ready";
	observedAtMs: number;
	pollIntervalMs: number;
	healthy: boolean;
	dryRun: boolean;
	unmanagedChannelIds: readonly number[];
	keys: readonly KeyUsage[];
}

export type SnapshotOutcome =
	| { kind: "ok"; snapshot: PoolSnapshot }
	| { kind: "starting"; snapshot: PoolSnapshot }
	| { kind: "cancelled" };
