import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountTag, addKey, getSnapshot } from "../src/control-client.js";
import { startJsonServer } from "./helpers.js";

let control: Awaited<ReturnType<typeof startJsonServer>>;
let relay: Awaited<ReturnType<typeof startJsonServer>>;

beforeAll(async () => {
	control = await startJsonServer({});
	relay = await startJsonServer({});
});
afterAll(async () => {
	await control.close();
	await relay.close();
});

const instanceId = "inst-1";
const info = () => ({
	instanceId,
	controlUrl: control.url,
	relayBaseUrl: `${relay.url}/v1`,
});

function statusBody(overrides: Record<string, unknown> = {}) {
	return {
		updated_at: Date.now(),
		dry_run: false,
		new_api_healthy: true,
		new_api_base: relay.url,
		client_endpoint: `${relay.url}/v1`,
		keys: [
			{
				name: "acct-a",
				channel_id: 1,
				five_hour_pct: 20,
				weekly_pct: 40,
				five_hour_reset: 1750000000000,
				max_pct: 40,
				tier: "active",
			},
			{ name: "acct-b", channel_id: 2, max_pct: null, tier: "unknown", error: "probe failed" },
		],
		channels: [
			{ id: 1, enabled: true, group: "default" },
			{ id: 2, enabled: false, group: "default" },
			{ id: 9, enabled: true, group: "default" },
		],
		...overrides,
	};
}

function serviceBody(overrides: Record<string, unknown> = {}) {
	return { name: "quota-throttle", apiVersion: 1, instanceId, phase: "ready", poll_interval_secs: 60, ...overrides };
}

describe("getSnapshot", () => {
	it("validates and normalizes a ready snapshot", async () => {
		const server = await startJsonServer({
			"GET /api/status.service": () => ({ status: 200, body: serviceBody() }),
			"GET /api/status": () => ({ status: 200, body: statusBody() }),
		});
		try {
			const outcome = await getSnapshot({ ...info(), controlUrl: server.url }, new AbortController().signal);
			if (outcome.kind !== "ok") throw new Error(`expected ok: ${JSON.stringify(outcome)}`);
			expect(outcome.snapshot.keys[0]).toMatchObject({
				id: "acct-a",
				route: "enabled",
				tier: "active",
				query: "ok",
				fiveHour: { usedPercent: 20, resetAtMs: 1750000000000 },
			});
			expect(outcome.snapshot.keys[1]).toMatchObject({ query: "failed", route: "disabled" });
			expect(outcome.snapshot.unmanagedChannelIds).toEqual([9]);
		} finally {
			await server.close();
		}
	});

	it("rejects wrong identity, stale snapshots, and starting snapshots", async () => {
		const base = {
			"GET /api/status.service": () => ({ status: 200, body: serviceBody() }),
			"GET /api/status": () => ({ status: 200, body: statusBody() }),
		};
		const wrongIdentity = await startJsonServer({
			"GET /api/status.service": () => ({ status: 200, body: serviceBody({ instanceId: "other" }) }),
			"GET /api/status": () => ({ status: 200, body: statusBody() }),
		});
		const stale = await startJsonServer({
			...base,
			"GET /api/status": () => ({ status: 200, body: statusBody({ updated_at: Date.now() - 600_000 }) }),
		});
		const starting = await startJsonServer({
			"GET /api/status.service": () => ({ status: 200, body: serviceBody({ phase: "starting" }) }),
			"GET /api/status": () => ({ status: 200, body: statusBody() }),
		});
		try {
			expect(await getSnapshot({ ...info(), controlUrl: wrongIdentity.url }, new AbortController().signal)).toMatchObject({ kind: "error", code: "identity-conflict" });
			expect(await getSnapshot({ ...info(), controlUrl: stale.url }, new AbortController().signal)).toMatchObject({ kind: "error", code: "timeout" });
			expect(await getSnapshot({ ...info(), controlUrl: starting.url }, new AbortController().signal)).toMatchObject({ kind: "starting" });
		} finally {
			await wrongIdentity.close();
			await stale.close();
			await starting.close();
		}
	});
});

describe("addKey", () => {
	it("posts a stable tag with selectors and maps replies", async () => {
		const seen: { body: unknown; headers: Record<string, string> }[] = [];
		const server = await startJsonServer({
			"POST /api/keys": (request) => {
				seen.push(request);
				if (request.headers["x-qt-panel"] === undefined) return { status: 403 };
				return { status: 201, body: { kind: "added", name: "acct-a", channel_id: 1 } };
			},
		});
		try {
			const state = { version: 1 as const, instanceId, adminUsername: "u", adminPassword: "p" };
			const input = { apiKey: "sk-upstream", scope: { kind: "team" as const, organization: "org", project: "proj" } };
			const tag = accountTag(input);
			expect(tag).toMatch(/^acct-[0-9a-f]{12}$/);
			expect(accountTag({ apiKey: "sk-other", scope: input.scope })).not.toBe(tag);
			const result = await addKey(state, { ...info(), controlUrl: server.url }, input, new AbortController().signal);
			expect(result).toMatchObject({ kind: "ok", value: { kind: "added", channelId: 1 } });
			expect(seen[0]?.body).toMatchObject({ name: tag, api_key: "sk-upstream", org: "org", project: "proj" });
		} finally {
			await server.close();
		}
	});
});
