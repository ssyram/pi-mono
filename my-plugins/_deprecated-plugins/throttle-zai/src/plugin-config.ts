/** Static plugin configuration: read, validate, derive paths. Pure data layer. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { backendFailure, type BackendResult } from "./backend-failure.js";

export type PlanScope = { kind: "personal" } | { kind: "team"; organization: string; project: string };

export type QuotaPolicy =
	| { kind: "equal" }
	| { kind: "weighted"; unit: string; keys: Readonly<Record<string, { fiveHour: number; weekly: number }>> };

export interface PluginConfig {
	version: 1;
	executable: string;
	controlUrl: string;
	relayBaseUrl: string;
	plan: PlanScope;
	quota: QuotaPolicy;
}

export interface PluginPaths {
	configFile: string;
	stateDir: string;
	bootstrapFile: string;
	clientsDir: string;
	backendDir: string;
	backendConfigFile: string;
}

export function pluginPaths(agentDir: string): PluginPaths {
	const root = join(agentDir, "throttle-zai");
	return {
		configFile: join(root, "config.json"),
		stateDir: join(root, "state"),
		bootstrapFile: join(root, "state", "bootstrap.json"),
		clientsDir: join(root, "state", "clients"),
		backendDir: join(root, "backend"),
		backendConfigFile: join(root, "backend", "config.toml"),
	};
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

function parseControlOrigin(value: string): string | undefined {
	return parseLoopbackOrigin(value);
}

function parseRelayOrigin(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if ((url.pathname === "" || url.pathname === "/v1") && LOOPBACK_HOSTS.has(url.hostname) && url.protocol === "http:") {
		if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return undefined;
		return `${url.protocol}//${url.host}`;
	}
	return undefined;
}

function parseLoopbackOrigin(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:") return undefined;
	if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined;
	if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return undefined;
	if (url.pathname !== "/" && url.pathname !== "") return undefined;
	return `${url.protocol}//${url.host}`;
}

function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseQuota(value: unknown): QuotaPolicy | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.kind === "equal") return { kind: "equal" };
	if (record.kind !== "weighted") return undefined;
	const { unit, keys } = record;
	if (typeof unit !== "string" || unit.trim() === "" || unit.length > 32) return undefined;
	if (keys === null || typeof keys !== "object" || Array.isArray(keys)) return undefined;
	let fiveHourTotal = 0;
	let weeklyTotal = 0;
	const entries: Record<string, { fiveHour: number; weekly: number }> = {};
	for (const [key, raw] of Object.entries(keys as Record<string, unknown>)) {
		if (raw === null || typeof raw !== "object") return undefined;
		const window = raw as Record<string, unknown>;
		if (!isSafeInteger(window.fiveHour) || !isSafeInteger(window.weekly)) return undefined;
		fiveHourTotal += window.fiveHour;
		weeklyTotal += window.weekly;
		entries[key] = { fiveHour: window.fiveHour, weekly: window.weekly };
	}
	if (Object.keys(entries).length === 0) return undefined;
	if (!Number.isSafeInteger(fiveHourTotal) || !Number.isSafeInteger(weeklyTotal)) return undefined;
	return { kind: "weighted", unit, keys: entries };
}

function parsePlan(value: unknown): PlanScope | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.kind === "personal") return { kind: "personal" };
	if (record.kind !== "team") return undefined;
	const { organization, project } = record;
	if (typeof organization !== "string" || typeof project !== "string") return undefined;
	const org = organization.trim();
	const proj = project.trim();
	if (org === "" || proj === "") return undefined;
	if (/[\r\n]/.test(org) || /[\r\n]/.test(proj)) return undefined;
	return { kind: "team", organization: org, project: proj };
}

export function parsePluginConfig(raw: unknown): PluginConfig | undefined {
	if (raw === null || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	if (record.version !== 1) return undefined;
	if (typeof record.executable !== "string" || !record.executable.startsWith("/")) return undefined;
	const control = parseControlOrigin(record.controlUrl);
	const relayOrigin = parseRelayOrigin(record.relayBaseUrl);
	if (control === undefined || relayOrigin === undefined) return undefined;
	if (new URL(control).host === new URL(relayOrigin).host) return undefined;
	const plan = parsePlan(record.plan);
	const quota = parseQuota(record.quota);
	if (plan === undefined || quota === undefined) return undefined;
	return {
		version: 1,
		executable: record.executable,
		controlUrl: control,
		relayBaseUrl: `${relayOrigin}/v1`,
		plan,
		quota,
	};
}

export async function loadPluginConfig(path: string): Promise<BackendResult<PluginConfig>> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return backendFailure("configuration", "config.json missing");
		return backendFailure("storage", "config.json unreadable");
	}
	try {
		const parsed = parsePluginConfig(JSON.parse(text));
		return parsed ? { kind: "ok", value: parsed } : backendFailure("configuration", "config.json invalid");
	} catch {
		return backendFailure("configuration", "config.json invalid JSON");
	}
}
