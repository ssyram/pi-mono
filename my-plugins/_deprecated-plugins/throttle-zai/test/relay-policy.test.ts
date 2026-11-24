import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNewApiSession } from "../src/newapi-session.js";
import { ensureOwnedRelayPolicy } from "../src/relay-policy.js";
import { startJsonServer } from "./helpers.js";
import type { PoolSnapshot } from "../src/pool-snapshot.js";

let server: Awaited<ReturnType<typeof startJsonServer>>;
let options: Record<string, string>;
let puts: { key: string; value: string }[];

function snapshot(unmanagedChannelIds: number[] = []): PoolSnapshot {
	return {
		info: { instanceId: "i", controlUrl: server.url, relayBaseUrl: `${server.url}/v1` },
		phase: "ready",
		observedAtMs: Date.now(),
		pollIntervalMs: 60_000,
		healthy: true,
		dryRun: false,
		unmanagedChannelIds,
		keys: [],
	};
}

beforeAll(async () => {
	options = { GroupRatio: JSON.stringify({ default: 1, vip: 1 }), ModelRatio: JSON.stringify({ "gpt-x": 5 }) };
	puts = [];
	server = await startJsonServer({
		"POST /api/user/login": () => ({ status: 200, body: { success: true, data: { id: 1 } }, headers: { "set-cookie": "session=s; Path=/" } }),
		"GET /api/option/": () => ({ status: 200, body: { success: true, data: options } }),
		"PUT /api/option/": (request) => {
			const body = request.body as { key?: string; value?: string };
			if (typeof body?.key === "string" && typeof body?.value === "string") {
				puts.push({ key: body.key, value: body.value });
				options[body.key] = body.value;
				return { status: 200, body: { success: true, message: "" } };
			}
			return { status: 400, body: { success: false } };
		},
		"GET /api/user/self": () => ({ status: 200, body: { success: true, data: { id: 1, quota: 100 } } }),
	});
});
afterAll(async () => {
	await server.close();
});

describe("relay policy", () => {
	it("zeroes the default group, prices only missing known models, verifies wallet", async () => {
		const session = createNewApiSession(server.url, "qt-owner", "pw");
		await session.authenticate(new AbortController().signal);
		const result = await ensureOwnedRelayPolicy(session, snapshot(), ["glm-5.3", "gpt-x"], new AbortController().signal);
		expect(result).toMatchObject({ kind: "ok" });
		expect(puts).toHaveLength(2);
		expect(JSON.parse(puts[0].value)).toEqual({ default: 0, vip: 1 });
		expect(JSON.parse(puts[1].value)).toEqual({ "gpt-x": 5, "glm-5.3": 0 });
	});

	it("refuses unmanaged channels and non-positive wallet without writes", async () => {
		const session = createNewApiSession(server.url, "qt-owner", "pw");
		await session.authenticate(new AbortController().signal);
		const unmanaged = await ensureOwnedRelayPolicy(session, snapshot([7]), ["glm-5.3"], new AbortController().signal);
		expect(unmanaged).toMatchObject({ kind: "error", code: "relay-policy" });
		options.GroupRatio = JSON.stringify({ default: 1 });
		const before = puts.length;
		options["__wallet_zero__"] = "";
		const server2 = await startJsonServer({
			"POST /api/user/login": () => ({ status: 200, body: { success: true, data: { id: 1 } }, headers: { "set-cookie": "session=s; Path=/" } }),
			"GET /api/option/": () => ({ status: 200, body: { success: true, data: options } }),
			"PUT /api/option/": () => ({ status: 200, body: { success: true, message: "" } }),
			"GET /api/user/self": () => ({ status: 200, body: { success: true, data: { id: 1, quota: 0 } } }),
		});
		try {
			const zeroSession = createNewApiSession(server2.url, "qt-owner", "pw");
			await zeroSession.authenticate(new AbortController().signal);
			const zero = await ensureOwnedRelayPolicy(zeroSession, { ...snapshot(), info: { ...snapshot().info, controlUrl: server2.url } }, ["glm-5.3"], new AbortController().signal);
			expect(zero).toMatchObject({ kind: "error", code: "relay-policy" });
		} finally {
			await server2.close();
		}
		expect(puts.length).toBeGreaterThanOrEqual(before);
	});
});
