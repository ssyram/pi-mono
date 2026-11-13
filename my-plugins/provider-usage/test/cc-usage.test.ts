import assert from "node:assert/strict";
import test from "node:test";
import { parseClaudeCodeRateLimit, queryClaudeCodeUsage } from "../src/cc-usage.js";
import { formatLocalTime } from "../src/format-local-time.js";
import { route } from "../src/route.js";
import { captureSelection } from "../src/selection.js";
import { executeUsageQuery } from "../src/usage-query.js";
import type { Selection } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

const RESETS_AT = 4_102_444_800; // 2100-01-01, always in the future for tests
const EXPIRED_AT = 1; // 1970, always in the past

function rateLimitEntry(details: unknown): unknown {
	return {
		type: "message",
		message: {
			role: "assistant",
			provider: "claude-code",
			model: "opus",
			content: [],
			diagnostics: [{ type: "claude-code.rate-limit", details }],
		},
	};
}

test("routes the claude-code provider by provider id and process endpoint", () => {
	const model = makeModel({ provider: "claude-code", api: "claude-code-stream-json", baseUrl: "process://claude-code" });
	const selection = captureSelection(
		{ sessionManager: { getSessionId: () => "session-1" }, modelRegistry: { getProvider: () => undefined } },
		model,
	);
	assert.ok(selection);
	assert.equal(route(selection).kind, "claude-code");
	const byId = { ...selection, endpoint: "" } as Selection;
	assert.equal(route(byId).kind, "claude-code");
});

test("reads subscriber windows from the latest rate-limit diagnostic", () => {
	const entries = [
		rateLimitEntry({ five_hour: { used_percentage: 20, resets_at: RESETS_AT } }),
		rateLimitEntry({ five_hour: { used_percentage: 62.4, resets_at: RESETS_AT }, seven_day: { used_percentage: 41, resets_at: RESETS_AT } }),
	];
	const result = queryClaudeCodeUsage(() => entries);
	assert.equal(result.kind, "available");
	if (result.kind !== "available") throw new Error("unreachable");
	assert.equal(result.compact, "62%(5h) 41%(7d)");
	assert.ok(result.text.includes(formatLocalTime(RESETS_AT * 1000)));
	assert.match(result.text, /62%\(5h\)/);
	assert.match(result.text, /41%\(7d\)/);
});

test("drops expired windows and hides when nothing remains", () => {
	const windows = parseClaudeCodeRateLimit(
		{ five_hour: { used_percentage: 62, resets_at: EXPIRED_AT }, seven_day: { used_percentage: 41, resets_at: RESETS_AT } },
	);
	assert.deepEqual(windows.map((window) => window.label), ["7d"]);
	const expired = queryClaudeCodeUsage(() => [
		rateLimitEntry({ five_hour: { used_percentage: 62, resets_at: EXPIRED_AT } }),
	]);
	assert.equal(expired.kind, "not-applicable");
});

test("parses the generic limits array shape", () => {
	const result = queryClaudeCodeUsage(() => [
		rateLimitEntry({ limits: [{ kind: "usage", group: "five_hour", percent: 55, resets_at: RESETS_AT }] }),
	]);
	assert.equal(result.kind, "available");
	if (result.kind !== "available") throw new Error("unreachable");
	assert.equal(result.compact, "55%(5h)");
});

test("hides when the payload carries no windows (status-only) or no diagnostic exists", () => {
	assert.equal(queryClaudeCodeUsage(() => [rateLimitEntry({ status: "limited", resetsAt: RESETS_AT })]).kind, "not-applicable");
	assert.equal(queryClaudeCodeUsage(() => [{ type: "message", message: { role: "assistant", content: [] } }]).kind, "not-applicable");
	assert.equal(queryClaudeCodeUsage(() => []).kind, "not-applicable");
	assert.equal(queryClaudeCodeUsage(undefined).kind, "not-applicable");
});

test("executes the claude-code branch without resolving provider auth", async () => {
	const model = makeModel({ provider: "claude-code", api: "claude-code-stream-json", baseUrl: "process://claude-code" });
	const selection = captureSelection(
		{ sessionManager: { getSessionId: () => "session-1" }, modelRegistry: { getProvider: () => undefined } },
		model,
	);
	assert.ok(selection);
	let authCalls = 0;
	const registry = {
		getApiKeyAndHeaders: async () => {
			authCalls += 1;
			return { ok: true, apiKey: "x" };
		},
	};
	const result = await executeUsageQuery(
		selection,
		{ kind: "claude-code", endpoint: "process://claude-code" },
		registry,
		new AbortController().signal,
		undefined,
		undefined,
		() => [rateLimitEntry({ five_hour: { used_percentage: 30, resets_at: RESETS_AT } })],
		async () => undefined,
	);
	assert.equal(result.kind, "available");
	assert.equal(authCalls, 0);
});

test("prefers the live /usage channel over session diagnostics", async () => {
	const model = makeModel({ provider: "claude-code", api: "claude-code-stream-json", baseUrl: "process://claude-code" });
	const selection = captureSelection(
		{ sessionManager: { getSessionId: () => "session-1" }, modelRegistry: { getProvider: () => undefined } },
		model,
	);
	assert.ok(selection);
	const result = await executeUsageQuery(
		selection,
		{ kind: "claude-code", endpoint: "process://claude-code" },
		{ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "x" }) },
		new AbortController().signal,
		undefined,
		undefined,
		() => [rateLimitEntry({ five_hour: { used_percentage: 30, resets_at: RESETS_AT } })],
		async () => ({ kind: "available", text: "live", compact: "live" }),
	);
	assert.deepEqual(result, { kind: "available", text: "live", compact: "live" });
});
