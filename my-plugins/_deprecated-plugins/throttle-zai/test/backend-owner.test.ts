import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackendOwner } from "../src/backend-owner.js";
import { createBootstrapState } from "../src/backend-bootstrap.js";
import type { PluginConfig, PluginPaths } from "../src/plugin-config.js";

const root = await mkdtemp(join(tmpdir(), "throttle-zai-owner-"));
const controlServer: Server = createServer();
const relayServer: Server = createServer();
let controlPort = 0;
let relayPort = 0;
let phase = "ready";
let relayHealthy = false;
let expectedInstanceId = "inst-owner";
let ensureCalls = 0;
let snapshotRequests = 0;

function reply(response: Parameters<Parameters<typeof createServer>[0]>[1], status: number, body: unknown, headers?: Record<string, string>): void {
	response.writeHead(status, { "content-type": "application/json", ...(headers ?? {}) });
	response.end(JSON.stringify(body));
}

controlServer.on("request", (request, response) => {
	const path = request.url ?? "";
	snapshotRequests++;
	if (path === "/api/status.service" && request.method === "GET") {
		reply(response, 200, { name: "quota-throttle", apiVersion: 1, instanceId: expectedInstanceId, phase, poll_interval_secs: 1 });
	} else if (path === "/api/status" && request.method === "GET") {
		reply(response, 200, {
			updated_at: Date.now(),
			dry_run: false,
			new_api_healthy: relayHealthy,
			new_api_base: `http://127.0.0.1:${relayPort}`,
			client_endpoint: `http://127.0.0.1:${relayPort}/v1`,
			keys: [{ name: "acct-a", channel_id: 1, five_hour_pct: 10, weekly_pct: 20, max_pct: 20, tier: "active" }],
			channels: [{ id: 1, enabled: true, group: "default" }],
		});
	} else if (path === "/api/backend/ensure" && request.method === "POST") {
		ensureCalls++;
		relayHealthy = true;
		phase = "ready";
		reply(response, 200, { kind: "ready", instanceId: "inst-owner" });
	} else {
		reply(response, 404, { error: "not found" });
	}
});
relayServer.on("request", (request, response) => {
	const path = request.url ?? "";
	if (path === "/api/status" && request.method === "GET") {
		reply(response, relayHealthy ? 200 : 503, relayHealthy ? "{}" : { error: "down" });
	} else if (path === "/api/user/login" && request.method === "POST") {
		reply(response, 200, { success: true, data: { id: 1 } }, { "set-cookie": "session=s; Path=/" });
	} else if (path === "/api/option/" && request.method === "GET") {
		reply(response, 200, { success: true, data: { GroupRatio: JSON.stringify({ default: 0 }), ModelRatio: JSON.stringify({ "glm-5.3": 0 }) } });
	} else if (path === "/api/option/" && request.method === "PUT") {
		reply(response, 200, { success: true, message: "" });
	} else if (path === "/api/user/self" && request.method === "GET") {
		reply(response, 200, { success: true, data: { id: 1, quota: 100 } });
	} else {
		reply(response, 404, { error: "not found" });
	}
});

beforeAll(async () => {
	await new Promise<void>((resolve) => controlServer.listen(0, "127.0.0.1", resolve));
	await new Promise<void>((resolve) => relayServer.listen(0, "127.0.0.1", resolve));
	controlPort = (controlServer.address() as { port: number }).port;
	relayPort = (relayServer.address() as { port: number }).port;
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
	await new Promise<void>((resolve) => controlServer.close(() => resolve()));
	await new Promise<void>((resolve) => relayServer.close(() => resolve()));
});

function ownerDeps(): { config: PluginConfig; paths: PluginPaths } {
	return {
		config: {
			version: 1,
			executable: "/nonexistent/quota-throttle",
			controlUrl: `http://127.0.0.1:${controlPort}`,
			relayBaseUrl: `http://127.0.0.1:${relayPort}/v1`,
			plan: { kind: "personal" },
			quota: { kind: "equal" },
		},
		paths: {
			configFile: join(root, "config.json"),
			stateDir: join(root, "state"),
			bootstrapFile: join(root, "state", "bootstrap.json"),
			clientsDir: join(root, "state", "clients"),
			backendDir: join(root, "backend"),
			backendConfigFile: join(root, "backend", "config.toml"),
		},
	};
}

describe("backend owner", () => {
	it("returns uninitialized without bootstrap state and never spawns", async () => {
		const { config, paths } = ownerDeps();
		const owner = createBackendOwner(config, paths, ["glm-5.3"]);
		const result = await owner.ensureRunning(new AbortController().signal);
		expect(result).toMatchObject({ kind: "error", code: "uninitialized" });
		const snapshot = await owner.readOwnedSnapshot(new AbortController().signal);
		expect(snapshot).toMatchObject({ kind: "error", code: "uninitialized" });
	});

	it("recovers an unhealthy proxy via ensure, prepares policy once, and serves snapshots", async () => {
		const { config, paths } = ownerDeps();
		const bootstrap = await createBootstrapState(paths.bootstrapFile);
		if (bootstrap.kind !== "ok") throw new Error("bootstrap failed");
		const owner = createBackendOwner({ ...config, controlUrl: `http://127.0.0.1:${controlPort}` }, { ...paths, bootstrapFile: paths.bootstrapFile }, ["glm-5.3"]);
		expectedInstanceId = bootstrap.value.instanceId;
		phase = "ready";
		relayHealthy = false;
		const running = await owner.ensureRunning(new AbortController().signal);
		if (running.kind !== "ok") throw new Error(`ensureRunning failed: ${JSON.stringify(running)}`);
		expect(ensureCalls).toBeGreaterThanOrEqual(1);
		const snapshot = await owner.readOwnedSnapshot(new AbortController().signal);
		if (snapshot.kind !== "ok") throw new Error(`snapshot failed: ${JSON.stringify(snapshot)}`);
		expect(snapshot.value.keys[0]).toMatchObject({ id: "acct-a", query: "ok" });
		const session = await owner.managementSession(new AbortController().signal);
		expect(session).toMatchObject({ kind: "ok" });
		const requestsBefore = snapshotRequests;
		await owner.ensureRunning(new AbortController().signal);
		expect(snapshotRequests - requestsBefore).toBeLessThanOrEqual(4);
	}, 20_000);
});
