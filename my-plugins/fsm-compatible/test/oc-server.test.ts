import assert from "node:assert/strict";
import test from "node:test";
import { OcHttpError } from "../src/protocol/oc-route.ts";
import { OcServer, type OcHandlers } from "../src/protocol/oc-server.ts";
import { RuntimeError } from "../src/runtime/runtime-error.ts";

function handlers(overrides: Partial<OcHandlers> = {}): OcHandlers {
	const judges = new Set<string>(["judge-1"]);
	return {
		roster: () => [{ id: "root", parentID: null }],
		statuses: () => ({ root: { type: "busy" } }),
		session: (id) => judges.has(id) || id === "root" ? { id, parentID: null } : (() => { throw new OcHttpError(404); })(),
		children: (id) => id === "root" ? [{ id: "child" }] : (() => { throw new OcHttpError(404); })(),
		messages: (id) => id === "root" ? [{ info: { role: "user" }, parts: [] }] : (() => { throw new OcHttpError(404); })(),
		createSession: async (body) => {
			if (typeof body !== "object" || body === null || (body as { title?: unknown }).title !== "fsm-gate") throw new OcHttpError(400);
			return { id: "judge-2" };
		},
		postMessage: async (id, body) => {
			if (id !== "judge-1") throw new OcHttpError(404);
			if (typeof body !== "object" || body === null || !("system" in body)) throw new OcHttpError(400);
			return { info: { role: "assistant", sessionID: id }, parts: [] };
		},
		abort: async (id) => { if (id !== "judge-1") throw new OcHttpError(404); return true; },
		promptAsync: async (id, body) => {
			if (id !== "root") throw new OcHttpError(404);
			if (typeof body !== "object" || body === null) throw new OcHttpError(400);
		},
		...overrides,
	};
}

interface Harness {
	get(path: string): Promise<Response>;
	post(path: string, body?: string): Promise<Response>;
	put(path: string): Promise<Response>;
	close(): Promise<void>;
}

async function withServer(overrides: Partial<OcHandlers> = {}): Promise<Harness> {
	const server = new OcServer(handlers(overrides));
	server.setPassword("secret-pass");
	const base = await server.listen();
	const authorization = `Basic ${Buffer.from("opencode:secret-pass").toString("base64")}`;
	return {
		get: (path: string) => fetch(`${base}${path}`, { headers: { authorization } }),
		post: (path: string, body = "{}") => fetch(`${base}${path}`, { method: "POST", headers: { authorization }, body }),
		put: (path: string) => fetch(`${base}${path}`, { method: "PUT", headers: { authorization } }),
		close: () => server.close(),
	};
}

test("auth accepts loopback tools without credentials (OC parity); wrong credentials rejected; correct passes", async (t) => {
	const server = new OcServer(handlers());
	server.setPassword("secret-pass");
	const base = await server.listen();
	t.after(() => server.close());
	const good = `Basic ${Buffer.from("opencode:secret-pass").toString("base64")}`;
	// wire7 analysis scripts send no credentials (OC server has no auth).
	assert.equal((await fetch(`${base}/session`)).status, 200);
	assert.equal((await fetch(`${base}/session`, { headers: { authorization: `Basic ${Buffer.from("opencode:nope").toString("base64")}` } })).status, 401);
	assert.equal((await fetch(`${base}/session`, { headers: { authorization: good } })).status, 200);
});

test("GET routes serve roster/status/session/children/messages with real failures", async (t) => {
	const harness = await withServer();
	t.after(harness.close);
	assert.deepEqual(await (await harness.get("/session")).json(), [{ id: "root", parentID: null }]);
	assert.deepEqual(await (await harness.get("/session/status")).json(), { root: { type: "busy" } });
	assert.equal((await harness.get("/session/root/message")).status, 200);
	assert.equal((await harness.get("/session/ghost/message")).status, 404);
	assert.equal((await harness.get("/session/ghost")).status, 404);
	assert.equal((await harness.get("/entirely/unknown")).status, 404);
	assert.equal((await harness.get("/session/root/children/extra")).status, 404);
	assert.equal((await harness.put("/session")).status, 405);
});

test("POST create/message/abort/prompt_async semantics including strict 204", async (t) => {
	const harness = await withServer();
	t.after(harness.close);
	const created = await harness.post("/session", JSON.stringify({ title: "fsm-gate" }));
	assert.deepEqual(await created.json(), { id: "judge-2" });
	assert.equal((await harness.post("/session", JSON.stringify({ title: "other" }))).status, 400);
	const posted = await harness.post("/session/judge-1/message", JSON.stringify({ system: "s" }));
	assert.equal((await posted.json()).info.sessionID, "judge-1");
	assert.deepEqual(await (await harness.post("/session/judge-1/abort")).json(), true);
	const emptyBodyAbort = await harness.post("/session/judge-1/abort", "");
	assert.equal(emptyBodyAbort.status, 200);
	assert.deepEqual(await emptyBodyAbort.json(), true);
	const async204 = await harness.post("/session/root/prompt_async", JSON.stringify({ parts: [{ type: "text", text: "hi" }] }));
	assert.equal(async204.status, 204);
	assert.equal(await async204.text(), "");
	assert.equal((await harness.post("/session/root/prompt_async", "{not-json")).status, 400);
});

test("unavailable facts surface as 503 and oversized bodies are rejected before handlers run", async (t) => {
	const harness = await withServer({ statuses: () => { throw new RuntimeError("not-ready"); } });
	t.after(harness.close);
	assert.equal((await harness.get("/session/status")).status, 503);
	assert.equal((await harness.post("/session/root/prompt_async", "x".repeat(1024 * 1024 + 10))).status, 413);
});
