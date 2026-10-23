import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import { crossTreeRegistry, deliverCrossTree } from "../src/subagents/hc-session-registry.ts";
import { sendHcAgent } from "../src/subagents/hc-agent-send.ts";
import { publishHcExecution } from "../src/subagents/hc-record-publish.ts";
import { RecordStore } from "../src/records/record-store.ts";
import { protocolSessionId } from "../src/binding/create-root-binding.ts";
import { ROOT_SID, root } from "./admission-fixtures.ts";
import type { HcAgentRuntimeServices } from "../src/subagents/hc-agent-services.ts";
import type { HcSessionRecord } from "../src/subagents/hc-session-record.ts";

test("registry publishes, looks up and removes cross-tree entries", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "hc-registry-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const registry = crossTreeRegistry(dir);
	await registry.publish({ sid: "ses_abc123", bridgeUrl: "http://127.0.0.1:9/v1", bridgePassword: "pw" });
	assert.deepEqual(await registry.lookup("ses_abc123"), { sid: "ses_abc123", bridgeUrl: "http://127.0.0.1:9/v1", bridgePassword: "pw" });
	assert.equal(await registry.lookup("ses_missing"), undefined);
	assert.equal(await registry.lookup("not-a-sid"), undefined);
	await registry.remove("ses_abc123");
	assert.equal(await registry.lookup("ses_abc123"), undefined);
});

test("deliverCrossTree reports unknown owners and forwards to the owner bridge", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "hc-registry-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const registry = crossTreeRegistry(dir);
	assert.equal(await deliverCrossTree(registry, "ses_nope", "text"), "unknown");
	const seen: Array<{ auth?: string | undefined; body: string }> = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => { body += String(chunk); });
		request.on("end", () => {
			seen.push({ auth: request.headers.authorization, body });
			response.writeHead(200, { "content-type": "application/json" });
			response.end('{"ok":true}');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => { server.close(); });
	const address = server.address();
	assert.ok(address && typeof address === "object");
	await registry.publish({ sid: "ses_owner1", bridgeUrl: `http://127.0.0.1:${address.port}`, bridgePassword: "pw" });
	assert.equal(await deliverCrossTree(registry, "ses_owner1", "hello"), "delivered");
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.auth, `Basic ${Buffer.from("opencode:pw").toString("base64")}`);
	assert.deepEqual(JSON.parse(seen[0]!.body), { target: "ses_owner1", message: "hello" });
});

test("agent_send reaches foreign sids through the registry and refuses unknown ones", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "hc-registry-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const registry = crossTreeRegistry(dir);
	const delivered: string[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => { body += String(chunk); });
		request.on("end", () => { delivered.push(body); response.writeHead(200, { "content-type": "application/json" }); response.end('{"ok":true}'); });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => { server.close(); });
	const address = server.address();
	assert.ok(address && typeof address === "object");
	await registry.publish({ sid: "ses_foreign1", bridgeUrl: `http://127.0.0.1:${address.port}`, bridgePassword: "pw" });
	const callerRecord = { session_id: "ses_local", name: "origin", agent_type: "explore" };
	const services = {
		directory: {
			toAgentSessions: () => [{ session_id: "ses_local", parent_id: undefined, name: "origin", agent_type: "explore",
				title: "origin", time_created: 1, workdir: undefined, status: "idle" as const }],
			get: (id: string) => (id === "ses_local" ? callerRecord : undefined),
		},
		crossTree: registry,
	} as unknown as HcAgentRuntimeServices;
	assert.deepEqual(await sendHcAgent(services, { caller: "ses_local", target: "ses_foreign1", message: "cross" }), { resolved: "ses_foreign1" });
	assert.equal(delivered.length, 1);
	assert.ok(delivered[0]!.includes("[Agent message from origin (explore, ses_local)]"));
	await assert.rejects(sendHcAgent(services, { caller: "ses_local", target: "ses_nobody", message: "x" }),
		/no Agent found for session ses_nobody/i);
});

test("child executions publish a protocol-sid header carrying their real creation time", () => {
	const store = new RecordStore(root());
	const record = {
		session_id: "ses_child9",
		binding: { version: 1 as const, kind: "execution-child" as const, rootSessionId: ROOT_SID, sessionId: "ses_child9",
			agentId: "ses_child9", parentSessionId: "r", agentName: "explore", bootstrapRef: "/boot", requiredExtensions: [] },
		title: "child work", status: "idle", time_created: 1760000000000,
		workdir: { path: "/work/child9", source: "provided_cwd" as const, enforced: false as const },
		sessionFile: null,
	} as unknown as HcSessionRecord;
	publishHcExecution(store, record, "/instance");
	const listed = new Map(store.listExecutions().map((entry) => [entry.sessionId, entry]));
	const published = listed.get("ses_child9");
	assert.ok(published?.header);
	assert.equal(published.header.id, "ses_child9");
	assert.equal(published.header.cwd, "/work/child9");
	assert.equal(new Date(published.header.timestamp).getTime(), 1760000000000);
	assert.equal(store.rootProtocolId, protocolSessionId("r"));
});
