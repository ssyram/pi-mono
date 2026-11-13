// new-api 系中转（如 openlux）的纯 API Key 余额查询：GET {base}/api/usage/token/，原始配额 500000 = 1 美元。
import { isJsonRecord } from "./json-record.js";
import { sanitizeDisplayText } from "./sanitize-display-text.js";
import { RELAY_TOKEN_USAGE_PATH } from "./route.js";
import type { QueryResult, RequestAuth } from "./usage-contract.js";
import { requestJson } from "./usage-http.js";

export interface RelayBalance {
	unlimited: boolean;
	availableUsd: number;
	usedUsd: number;
	grantedUsd: number;
	tokenName: string | undefined;
}

const QUOTA_PER_USD = 500_000;

function nonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function quotaToUsd(value: number): number {
	return Math.round((value / QUOTA_PER_USD) * 100) / 100;
}

function usd(value: number): string {
	return `$${value.toFixed(2)}`;
}

export function parseRelayBalance(value: unknown): RelayBalance | undefined {
	if (!isJsonRecord(value) || value.success !== true || !isJsonRecord(value.data)) return undefined;
	const data = value.data;
	if (data.object !== "token_usage" || typeof data.unlimited_quota !== "boolean") return undefined;
	const available = nonNegative(data.total_available);
	const used = nonNegative(data.total_used);
	const granted = nonNegative(data.total_granted);
	if (available === undefined || used === undefined || granted === undefined) return undefined;
	const tokenName = typeof data.name === "string" && data.name !== "" ? data.name : undefined;
	return { unlimited: data.unlimited_quota, availableUsd: quotaToUsd(available), usedUsd: quotaToUsd(used), grantedUsd: quotaToUsd(granted), tokenName };
}

export function formatRelayCompact(balance: RelayBalance): string {
	return balance.unlimited ? "Bal ∞" : `Bal ${usd(balance.availableUsd)}`;
}

export function formatRelayText(balance: RelayBalance): string {
	const name = balance.tokenName ? ` (key: ${sanitizeDisplayText(balance.tokenName)})` : "";
	if (balance.unlimited) return `Unlimited balance${name}`;
	return `Balance ${usd(balance.availableUsd)}, used ${usd(balance.usedUsd)} / granted ${usd(balance.grantedUsd)}${name}`;
}

export async function queryRelayBalance(auth: RequestAuth, signal: AbortSignal): Promise<QueryResult> {
	const response = await requestJson(`${auth.endpoint}${RELAY_TOKEN_USAGE_PATH}`, auth.headers, signal);
	if (response.kind !== "json") {
		if (response.kind === "error" && response.status === 404) return { kind: "unsupported" };
		return response;
	}
	const balance = parseRelayBalance(response.value);
	return balance ? { kind: "available", text: formatRelayText(balance), compact: formatRelayCompact(balance) } : { kind: "unsupported" };
}
