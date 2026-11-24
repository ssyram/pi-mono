/** Stable gateway client tokens: intent journal, no blind replay of non-idempotent creates. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { backendFailure, type BackendResult } from "./backend-failure.js";
import { readPrivateJson, writePrivateJson } from "./backend-bootstrap.js";
import type { JsonValue, NewApiSession } from "./newapi-session.js";

export type TokenJournal =
	| { kind: "creating"; name: string; startedAtMs: number }
	| { kind: "ready"; name: string; tokenId: number }
	| { kind: "uncertain"; name: string; startedAtMs: number };

interface TokenRecord {
	id?: unknown;
	name?: unknown;
	status?: unknown;
	group?: unknown;
	unlimited_quota?: unknown;
	expired_time?: unknown;
}

const ISSUE_TIMEOUT_MS = 60_000;
const PAGE_LIMIT = 100;

export function clientTokenName(instanceId: string, profileId: string): string {
	const digest = createHash("sha256").update(`${instanceId}:${profileId}`).digest("hex").slice(0, 32);
	return `qt-${digest}`;
}

function parseJournal(raw: unknown, name: string): TokenJournal | "invalid" {
	const record = raw as Record<string, unknown> | null;
	if (!record || typeof record !== "object") return "invalid";
	if (record.name !== name) return "invalid";
	if (record.kind === "ready") {
		return typeof record.tokenId === "number" && Number.isInteger(record.tokenId)
			? { kind: "ready", name, tokenId: record.tokenId }
			: "invalid";
	}
	if (record.kind === "creating" || record.kind === "uncertain") {
		return typeof record.startedAtMs === "number" ? { kind: record.kind, name, startedAtMs: record.startedAtMs } : "invalid";
	}
	return "invalid";
}

function validToken(record: TokenRecord | undefined, name: string): boolean {
	return (
		record !== undefined &&
		record.name === name &&
		record.status === 1 &&
		record.group === "default" &&
		record.unlimited_quota === true &&
		record.expired_time === -1
	);
}

async function findTokenId(session: NewApiSession, name: string, signal: AbortSignal): Promise<BackendResult<number | "ambiguous" | undefined>> {
	for (let page = 1; page <= PAGE_LIMIT; page++) {
		const listed = await session.read(`/api/token/?p=${page}&page_size=100`, signal);
		if (listed.kind !== "ok") return listed;
		const data = listed.value as { items?: unknown; total?: unknown } | null;
		const items = Array.isArray(data?.items) ? (data.items as TokenRecord[]) : [];
		const matches = items.filter((item) => item?.name === name);
		if (matches.length > 1) return { kind: "ok", value: "ambiguous" };
		if (matches.length === 1) {
			const id = matches[0].id;
			return typeof id === "number" ? { kind: "ok", value: id } : backendFailure("invalid-response", "token id");
		}
		const total = typeof data?.total === "number" ? data.total : items.length;
		if (items.length === 0 || page * 100 >= total) return { kind: "ok", value: undefined };
	}
	return backendFailure("invalid-response", "token list overflow");
}

async function adoptById(
	session: NewApiSession,
	tokenId: number,
	name: string,
	journalPath: string,
	signal: AbortSignal,
): Promise<BackendResult<string>> {
	const detail = await session.read(`/api/token/${tokenId}`, signal);
	if (detail.kind !== "ok") return detail;
	const record = detail.value as TokenRecord | null;
	if (record?.status === 2 || record?.status === 3) return backendFailure("client-disabled", name);
	if (!validToken(record ?? undefined, name)) return backendFailure("invalid-response", "token shape");
	const persisted = await writePrivateJson(journalPath, { kind: "ready", name, tokenId });
	if (persisted.kind !== "ok") return persisted;
	return await fetchFullKey(session, tokenId, signal);
}

async function fetchFullKey(session: NewApiSession, tokenId: number, signal: AbortSignal): Promise<BackendResult<string>> {
	const keyReply = await session.write("POST", `/api/token/${tokenId}/key`, null, signal);
	if (keyReply.kind !== "ok") return keyReply;
	const data = keyReply.value as { key?: unknown } | null;
	if (typeof data?.key !== "string" || data.key.trim() === "") {
		return backendFailure("invalid-response", "token full key");
	}
	return { kind: "ok", value: data.key };
}

export async function ensureClientToken(
	instanceId: string,
	profileId: string,
	clientsDir: string,
	session: NewApiSession,
	signal: AbortSignal,
): Promise<BackendResult<string>> {
	if (signal.aborted) return { kind: "cancelled" };
	const name = clientTokenName(instanceId, profileId);
	const journalPath = join(clientsDir, `${name}.json`);
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(ISSUE_TIMEOUT_MS)]);

	const loaded = await readPrivateJson(journalPath);
	let journal: TokenJournal | undefined;
	if (loaded.kind === "ok") {
		const parsed = parseJournal(loaded.value, name);
		if (parsed === "invalid") return backendFailure("storage", "client journal invalid");
		journal = parsed;
	} else if (loaded.kind !== "error" || loaded.code !== "uninitialized") {
		return loaded;
	}

	if (journal?.kind === "ready") {
		const detail = await session.read(`/api/token/${journal.tokenId}`, deadline);
		if (detail.kind === "ok") {
			const record = detail.value as TokenRecord | null;
			if (record?.status === 2 || record?.status === 3) return backendFailure("client-disabled", name);
			if (validToken(record ?? undefined, name)) return await fetchFullKey(session, journal.tokenId, deadline);
		}
	}

	if (journal === undefined) {
		const existing = await findTokenId(session, name, deadline);
		if (existing.kind !== "ok") return existing;
		if (existing.value === "ambiguous") return backendFailure("ambiguous-write", `multiple tokens named ${name}`);
		if (existing.value !== undefined) {
			return await adoptById(session, existing.value, name, journalPath, deadline);
		}
	} else if (journal.kind === "creating" || journal.kind === "uncertain") {
		const existing = await findTokenId(session, name, deadline);
		if (existing.kind !== "ok") return existing;
		if (existing.value === "ambiguous") return backendFailure("ambiguous-write", `multiple tokens named ${name}`);
		if (existing.value === undefined) {
			if (journal.kind === "uncertain") return backendFailure("operation-uncertain", name);
			const persisted = await writePrivateJson(journalPath, { kind: "uncertain", name, startedAtMs: journal.startedAtMs });
			if (persisted.kind !== "ok") return persisted;
			return backendFailure("operation-uncertain", name);
		}
		return await adoptById(session, existing.value, name, journalPath, deadline);
	}

	const creating = await writePrivateJson(journalPath, { kind: "creating", name, startedAtMs: Date.now() });
	if (creating.kind !== "ok") return creating;
	const created = await session.write("POST", "/api/token/", { name, unlimited_quota: true, expired_time: -1, group: "default" } as JsonValue, deadline);
	if (created.kind !== "ok") {
		await writePrivateJson(journalPath, { kind: "uncertain", name, startedAtMs: Date.now() });
		return backendFailure("ambiguous-write", "token create");
	}
	const found = await findTokenId(session, name, deadline);
	if (found.kind !== "ok") return found;
	if (found.value === "ambiguous") return backendFailure("ambiguous-write", `multiple tokens named ${name}`);
	if (found.value === undefined) {
		await writePrivateJson(journalPath, { kind: "uncertain", name, startedAtMs: Date.now() });
		return backendFailure("ambiguous-write", "token create unconfirmed");
	}
	const persisted = await writePrivateJson(journalPath, { kind: "ready", name, tokenId: found.value });
	if (persisted.kind !== "ok") return persisted;
	return await fetchFullKey(session, found.value, deadline);
}
