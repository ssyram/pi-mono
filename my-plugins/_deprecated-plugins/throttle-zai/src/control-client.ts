/** quota-throttle control-plane client: snapshot validation and account import. */
import { createHash } from "node:crypto";
import { backendFailure, type BackendResult } from "./backend-failure.js";
import type { BackendInfo, PoolSnapshot } from "./pool-snapshot.js";
import type { BootstrapState } from "./backend-bootstrap.js";

interface ServiceMetadata {
	name: string;
	apiVersion: number;
	instanceId: string;
	phase: string;
	poll_interval_secs?: number;
}

interface RawKey {
	name?: unknown;
	channel_id?: unknown;
	five_hour_pct?: unknown;
	weekly_pct?: unknown;
	five_hour_reset?: unknown;
	weekly_reset?: unknown;
	max_pct?: unknown;
	tier?: unknown;
	error?: unknown;
}

interface RawChannel {
	id?: unknown;
	enabled?: unknown;
	group?: unknown;
}

interface RawStatus {
	updated_at?: unknown;
	dry_run?: unknown;
	new_api_healthy?: unknown;
	new_api_base?: unknown;
	client_endpoint?: unknown;
	keys?: unknown;
	channels?: unknown;
}

const GET_TIMEOUT_MS = 3_000;
const ADD_KEY_TIMEOUT_MS = 75_000;

async function getJson(url: string, signal: AbortSignal, timeoutMs: number): Promise<BackendResult<unknown>> {
	if (signal.aborted) return { kind: "cancelled" };
	let response: Response;
	try {
		response = await fetch(url, {
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
		});
	} catch (error) {
		if (signal.aborted) return { kind: "cancelled" };
		return backendFailure("network", "control request", String(error));
	}
	if (!response.ok) return backendFailure("http", "control request", response.status);
	try {
		return { kind: "ok", value: await response.json() };
	} catch {
		return backendFailure("invalid-response", "control request");
	}
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindow(pct: unknown, reset: unknown): { usedPercent: number; resetAtMs?: number } | undefined {
	const percent = numberOrUndefined(pct);
	if (percent === undefined || percent < 0 || percent > 100) return undefined;
	const resetAt = numberOrUndefined(reset);
	return resetAt === undefined ? { usedPercent: percent } : { usedPercent: percent, resetAtMs: resetAt };
}

function parseTier(value: unknown): PoolSnapshot["keys"][number]["tier"] {
	return value === "active" || value === "standby" || value === "exhausted" ? value : "unknown";
}

export async function getSnapshot(
	expected: BackendInfo,
	signal: AbortSignal,
): Promise<{ kind: "ok"; snapshot: PoolSnapshot } | { kind: "starting"; snapshot: PoolSnapshot } | { kind: "cancelled" } | BackendFailure> {
	const service = await getJson(`${expected.controlUrl}/api/status.service`, signal, GET_TIMEOUT_MS);
	if (service.kind !== "ok") return service;
	const status = await getJson(`${expected.controlUrl}/api/status`, signal, GET_TIMEOUT_MS);
	if (status.kind !== "ok") return status;
	const meta = service.value as ServiceMetadata | null;
	const raw = status.value as RawStatus | null;
	if (!meta || typeof meta !== "object" || meta.name !== "quota-throttle") {
		return backendFailure("identity-conflict", "control service metadata");
	}
	if (meta.apiVersion !== 1 || meta.instanceId !== expected.instanceId) {
		return backendFailure("identity-conflict", "control service metadata");
	}
	if (raw?.client_endpoint !== expected.relayBaseUrl || raw.new_api_base === undefined) {
		return backendFailure("identity-conflict", "control endpoint mismatch");
	}
	const phase = meta.phase === "ready" ? "ready" : "starting";
	const pollIntervalMs = Math.max(1, numberOrUndefined(meta.poll_interval_secs) ?? 60) * 1000;
	const rawKeys = Array.isArray(raw.keys) ? (raw.keys as RawKey[]) : [];
	const rawChannels = Array.isArray(raw.channels) ? (raw.channels as RawChannel[]) : [];
	const managed = new Set<number>();
	const keys = [];
	for (const entry of rawKeys) {
		const channelId = numberOrUndefined(entry.channel_id);
		const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name : undefined;
		if (channelId === undefined || name === undefined) {
			return backendFailure("invalid-response", "control key entry");
		}
		managed.add(channelId);
		const channel = rawChannels.find((candidate) => numberOrUndefined(candidate?.id) === channelId);
		const enabled = channel?.enabled === true && channel?.group === "default";
		keys.push({
			id: name,
			channelId,
			route: enabled ? "enabled" : "disabled",
			tier: parseTier(entry.tier),
			fiveHour: parseWindow(entry.five_hour_pct, entry.five_hour_reset),
			weekly: parseWindow(entry.weekly_pct, entry.weekly_reset),
			query: entry.max_pct === null || entry.max_pct === undefined || entry.error != null ? "failed" : "ok",
		});
	}
	const unmanagedChannelIds: number[] = [];
	for (const channel of rawChannels) {
		const id = numberOrUndefined(channel?.id);
		if (id !== undefined && channel.enabled === true && channel.group === "default" && !managed.has(id)) {
			unmanagedChannelIds.push(id);
		}
	}
	const snapshot: PoolSnapshot = {
		info: expected,
		phase,
		observedAtMs: numberOrUndefined(raw.updated_at) ?? 0,
		pollIntervalMs,
		healthy: raw.new_api_healthy === true,
		dryRun: raw.dry_run === true,
		unmanagedChannelIds,
		keys,
	};
	if (phase !== "ready") return { kind: "starting", snapshot };
	const maxAgeMs = Math.max(2 * pollIntervalMs, 120_000);
	if (snapshot.observedAtMs <= 0 || Date.now() - snapshot.observedAtMs > maxAgeMs) {
		return backendFailure("timeout", "control snapshot stale");
	}
	return { kind: "ok", snapshot };
}

export interface KeyInput {
	apiKey: string;
	scope: { kind: "personal" } | { kind: "team"; organization: string; project: string };
}

export interface ImportedKey {
	kind: "added" | "existing";
	name: string;
	channelId: number;
}

/** Stable non-secret account label: hash of KEY + normalized team context. */
export function accountTag(input: KeyInput): string {
	const context =
		input.scope.kind === "team" ? `${input.scope.organization}\n${input.scope.project}` : "personal";
	return `acct-${createHash("sha256").update(`${input.apiKey}\n${context}`).digest("hex").slice(0, 12)}`;
}

export async function addKey(
	state: BootstrapState,
	expected: BackendInfo,
	input: KeyInput,
	signal: AbortSignal,
): Promise<BackendResult<ImportedKey>> {
	if (signal.aborted) return { kind: "cancelled" };
	const body: Record<string, string> = { name: accountTag(input), api_key: input.apiKey };
	if (input.scope.kind === "team") {
		body.org = input.scope.organization;
		body.project = input.scope.project;
	}
	let response: Response;
	try {
		response = await fetch(`${expected.controlUrl}/api/keys`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-qt-panel": "1" },
			body: JSON.stringify(body),
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(ADD_KEY_TIMEOUT_MS)]),
		});
	} catch (error) {
		if (signal.aborted) return { kind: "cancelled" };
		return backendFailure("ambiguous-write", "add key", String(error));
	}
	if (response.status === 409) return backendFailure("identity-conflict", "add key", 409);
	if (response.status === 503) return backendFailure("timeout", "add key busy", 503);
	if (response.status === 504) return backendFailure("timeout", "add key no reply", 504);
	if (response.status !== 200 && response.status !== 201) return backendFailure("quota-probe", "add key", response.status);
	let parsed: { kind?: unknown; name?: unknown; channel_id?: unknown };
	try {
		parsed = (await response.json()) as typeof parsed;
	} catch {
		return backendFailure("ambiguous-write", "add key reply unreadable", response.status);
	}
	const channelId = numberOrUndefined(parsed.channel_id);
	if (
		(parsed.kind !== "added" && parsed.kind !== "existing") ||
		typeof parsed.name !== "string" ||
		parsed.name === "" ||
		channelId === undefined
	) {
		return backendFailure("invalid-response", "add key reply");
	}
	return { kind: "ok", value: { kind: parsed.kind, name: parsed.name, channelId } };
}
