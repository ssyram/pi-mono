import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { createDaemonRequester, type DaemonReply, type DaemonRequester } from "../src/broker/daemon-request.ts";
import { FsmBroker } from "../src/broker/fsm-broker.ts";
import { registerAndConfirmSource } from "../src/broker/register-source.ts";
import { RuntimeError } from "../src/runtime/runtime-error.ts";
import { root } from "./admission-fixtures.ts";
import { fakeDaemon, fakeTransport, protocolDirectory } from "./broker-fixtures.ts";

const source = { rootSessionId: "r", pid: process.pid, cwd: "/work", serverUrl: "http://127.0.0.1:9001" };
const host = { pid: process.pid, startId: "1234" };

test("D2-1: register null alone does not authorize calls; every read-back field is matched", async () => {
	const valid = { session_id: "r", agent_pid: process.pid, cwd: "/work", kind: "opencode", opencode_server_url: source.serverUrl, transcript_path: null };
	for (const reply of [{ status: 404, body: {} }, ...Object.keys(valid).map((key) => ({ status: 200, body: { ...valid, [key]: "wrong" } }))]) {
		let step = 0;
		const request: DaemonRequester = async () => ++step === 1 ? { status: 200, body: null } : reply;
		await assert.rejects(registerAndConfirmSource(request, source, Date.now() + 1000), { code: "not-ready" });
		assert.equal(step, 2);
	}
	const daemon = fakeDaemon();
	await registerAndConfirmSource(daemon.request, source, Date.now() + 1000);
	assert.deepEqual(daemon.seen.map((item) => item.method), ["POST", "GET"]);
});

test("helper uses existing routes, reads fresh auth each request, and emits no auth secret", async (t) => {
	const dir = await protocolDirectory(t);
	const seen: string[] = [];
	const server = createServer((req, res) => {
		seen.push(String(req.headers["x-fsm-auth"]));
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ ok: true }));
	});
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(join(dir, "server.sock"), resolve); });
	t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
	const request = createDaemonRequester(dir);
	for (const token of ["secret-one", "secret-two"]) {
		await writeFile(join(dir, "auth.token"), token, { mode: 0o600 });
		const reply = await request({ method: "GET", path: "/health", deadline: Date.now() + 10000 });
		assert.deepEqual(reply, { status: 200, body: { ok: true } });
		assert.equal(JSON.stringify(reply).includes(token), false);
	}
	assert.deepEqual(seen, ["secret-one", "secret-two"]);
	await assert.rejects(request({ method: "POST", path: "/not-allowed", body: {}, deadline: Date.now() + 10000 }));
});

test("MCP handshake, paging and structured/error content are preserved", async (t) => {
	const { transport, catalog } = await fakeTransport(t);
	assert.deepEqual([...catalog.keys()], ["fsm_get_state", "fsm_set_var"]);
	const result = await transport.call("tools/call", { name: "fsm_get_state", arguments: {} }, { deadline: Date.now() + 1000 });
	assert.deepEqual(result, { content: [{ type: "text", text: "{}" }], structuredContent: { tool: "fsm_get_state" }, isError: false });
	assert.equal(catalog.get("fsm_set_var")?.validate({ value: "x" }), true);
	assert.equal(catalog.get("fsm_set_var")?.validate({ other: "x" }), false);
});

test("wrong response ID and uncertain timeout never become successful replies", async (t) => {
	for (const mode of ["wrong-id", "stall"]) {
		const { transport } = await fakeTransport(t, mode);
		await assert.rejects(transport.call("tools/call", { name: "fsm_get_state", arguments: {} }, { deadline: Date.now() + 40 }), { code: "delivery-unknown" });
		assert.equal(await transport.close(Date.now() + 1000), true);
	}
});

test("MCP progress notifications reach only their correlated call", async (t) => {
	const { transport } = await fakeTransport(t, "progress");
	const progress: unknown[] = [];
	await transport.call("tools/call", { name: "fsm_get_state", arguments: {} }, { deadline: Date.now() + 1000, onProgress: (value) => progress.push(value) });
	assert.equal(progress.length, 1);
});

test("broker orders source read-back before identity and actual tool call", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const daemon = fakeDaemon();
	const { transport, catalog } = await fakeTransport(t);
	const broker = new FsmBroker({ host, source, scope, request: daemon.request, transport, catalog });
	const result = await broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 2000 });
	assert.deepEqual(result.structuredContent, { tool: "fsm_get_state" });
	assert.deepEqual(daemon.seen.map((item) => item.path), ["/session/register", "/session/source?session=r", "/identity/acquire"]);
	assert.deepEqual(daemon.seen[2]?.body, { session_id: "r", agent_id: "main", tool_name: "fsm_get_state", agent_cli: "opencode", opencode_server_url: source.serverUrl });
	assert.deepEqual(await readdir(scope), []);
});

test("two broker roots share canonical isolation rather than independent local mutexes", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const daemon = fakeDaemon();
	let active = 0;
	let maximum = 0;
	const brokers: FsmBroker[] = [];
	for (const id of ["r", "r2"]) {
		const { transport, catalog } = await fakeTransport(t, "delay");
		const call = transport.call.bind(transport);
		transport.call = async (method, params, options) => {
			if (method !== "tools/call") return call(method, params, options);
			active++; maximum = Math.max(maximum, active);
			try { return await call(method, params, options); } finally { active--; }
		};
		brokers.push(new FsmBroker({ host, source: { ...source, rootSessionId: id }, scope, request: daemon.request, transport, catalog }));
	}
	const a = root();
	const b = { ...root(), rootSessionId: "r2", sessionId: "r2" };
	await Promise.all([brokers[0]!.invoke(a, "fsm_get_state", {}, { deadline: Date.now() + 3000 }),
		brokers[1]!.invoke(b, "fsm_get_state", {}, { deadline: Date.now() + 3000 })]);
	assert.equal(maximum, 1);
});

test("source read-back failure prevents identity or MCP mutation", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const seen: string[] = [];
	const request: DaemonRequester = async (input): Promise<DaemonReply> => {
		seen.push(input.path);
		return input.method === "POST" ? { status: 200, body: null } : { status: 404, body: {} };
	};
	const { transport, catalog } = await fakeTransport(t);
	const broker = new FsmBroker({ host, source, scope, request, transport, catalog });
	await assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 1000 }), { code: "not-ready" });
	assert.deepEqual(seen, ["/session/register", "/session/source?session=r"]);
	assert.deepEqual(await readdir(scope), []);
});

test("uncertain identity write cannot release its lease for a late server write", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const daemon = fakeDaemon();
	const request: DaemonRequester = async (input) => {
		if (input.path === "/identity/acquire") throw new RuntimeError("delivery-unknown");
		return daemon.request(input);
	};
	const { transport, catalog } = await fakeTransport(t);
	const broker = new FsmBroker({ host, source, scope, request, transport, catalog });
	await assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 1000 }), { code: "delivery-unknown" });
	const retained = await readdir(scope);
	assert.equal(retained.length, 1);
	assert.ok((await readFile(join(scope, retained[0]!, "owner.json"), "utf8")).includes('"rootSessionId":"r"'));
	await assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 1000 }), { code: "not-ready" });
});
