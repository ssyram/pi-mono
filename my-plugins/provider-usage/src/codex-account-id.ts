import { findHeader } from "./header-value.js";
import { isJsonRecord } from "./json-record.js";

const accountClaim = "https://api.openai.com/auth";

function accountIdFromJwt(authorization: string): string | undefined {
	const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
	if (!match) return undefined;
	const token = match[1];
	if (!token) return undefined;
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	const payload = parts[1];
	if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
	try {
		const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (!isJsonRecord(value) || !isJsonRecord(value[accountClaim])) return undefined;
		const accountId = value[accountClaim].chatgpt_account_id;
		return typeof accountId === "string" ? accountId.trim() || undefined : undefined;
	} catch {
		return undefined;
	}
}

export function codexAccountId(
	authorization: string,
	resolvedHeaders: Record<string, string | null> | undefined,
): string | undefined {
	return findHeader(resolvedHeaders, "chatgpt-account-id") ?? accountIdFromJwt(authorization);
}
