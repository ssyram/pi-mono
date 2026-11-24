import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo, IncomingMessage, ServerResponse } from "node:http";
import { fetchOfficialCatalog, MAX_CATALOG_BODY_BYTES } from "../../official-catalog/catalog-fetch.ts";

const SEED = 20261117;
const MIB = 1024 * 1024;
const MAX = MAX_CATALOG_BODY_BYTES;
const LM = "Fri, 02 Jan 2026 03:04:05 GMT";
const NAMES = ["ok200", "chunked200", "truncated", "malformed", "emptyBody", "mod304Validator", "mod304NoValidator", "status404", "status501", "status401", "status500", "rate429", "hangTimeout", "resetMidBody", "externalAbort", "sizeCap"] as const;
type Name = (typeof NAMES)[number];

function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Cfg { body: string; chunks: number; secs: number; hangMs: number; abortMs: number; over: boolean; extra: number }
interface Ctx { calls: number; validators: (string | undefined)[]; closed: boolean; cfg: Cfg }
type Handler = (ctx: Ctx) => (req: IncomingMessage, res: ServerResponse) => void;

const handlers: Record<Name, Handler> = {
	ok200: (c) => (_q, res) => { res.writeHead(200, { "content-type": "application/json", etag: '"wire-v1"', "last-modified": LM }); res.end(c.cfg.body) },
	chunked200: (c) => (_q, res) => {
		res.writeHead(200, { "content-type": "application/json" });
		const size = Math.ceil(c.cfg.body.length / c.cfg.chunks);
		let i = 0;
		const timer = setInterval(() => { res.write(c.cfg.body.slice(i * size, (i + 1) * size)); if (++i === c.cfg.chunks) { clearInterval(timer); res.end() } }, 1);
		res.on("close", () => clearInterval(timer));
	},
	truncated: (c) => (_q, res) => { res.writeHead(200, { "content-type": "application/json", "content-length": String(c.cfg.body.length + 512) }); res.write(c.cfg.body.slice(0, 40)); res.destroy() },
	malformed: (c) => (_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(c.cfg.body) },
	emptyBody: () => (_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("") },
	mod304Validator: (c) => (_q, res) => { if (c.validators[c.calls - 1] === '"wire-etag"') { res.writeHead(304, { etag: '"wire-etag"' }); res.end() } else { res.writeHead(200, { "content-type": "application/json" }); res.end(c.cfg.body) } },
	mod304NoValidator: () => (_q, res) => { res.writeHead(304, { etag: '"wire-etag"' }); res.end() },
	status404: () => (_q, res) => { res.writeHead(404, { "content-type": "text/plain" }); res.end("missing") },
	status501: () => (_q, res) => { res.writeHead(501, { "content-type": "text/plain" }); res.end("nope") },
	status401: () => (_q, res) => { res.writeHead(401, { "content-type": "text/plain" }); res.end("denied") },
	status500: () => (_q, res) => { res.writeHead(500, { "content-type": "text/plain" }); res.end("boom") },
	rate429: (c) => (_q, res) => { res.writeHead(429, { "retry-after": String(c.cfg.secs) }); res.end() },
	hangTimeout: () => (_q, res) => { res.writeHead(200, { "content-type": "application/json", "content-length": "2048" }) },
	externalAbort: () => (_q, res) => { res.writeHead(200, { "content-type": "application/json", "content-length": "2048" }) },
	resetMidBody: (c) => (_q, res) => { res.writeHead(200, { "content-type": "application/json", "content-length": String(c.cfg.body.length) }); res.write(c.cfg.body.slice(0, 64), () => { (res.socket as unknown as { resetAndDestroy: () => void }).resetAndDestroy() }) },
	sizeCap: (c) => (_q, res) => {
		res.writeHead(200, { "content-type": "application/json", "content-length": String(c.cfg.over ? MAX + c.cfg.extra : c.cfg.body.length) });
		res.on("error", () => {});
		if (!c.cfg.over) { res.end(c.cfg.body); return }
		const chunk = Buffer.alloc(MIB, 0x61);
		const timer = setInterval(() => { if (!res.destroyed) res.write(chunk) }, 0);
		res.on("close", () => clearInterval(timer));
	},
};

function prepare(name: Name, rep: number, rand: () => number): Cfg {
	const value = { sourceId: "wire-fixture", note: `n${Math.floor(rand() * 100000)}`, models: [{ id: `m${Math.floor(rand() * 1000)}` }] };
	const body = JSON.stringify(value);
	const cfg: Cfg = { body, chunks: 3 + Math.floor(rand() * 4), secs: 1 + Math.floor(rand() * 7), hangMs: 200 + Math.floor(rand() * 150), abortMs: 40 + Math.floor(rand() * 50), over: rep % 2 === 0, extra: 4096 + Math.floor(rand() * 65536) };
	if (name === "malformed") cfg.body = body.slice(0, body.length - 1 - Math.floor(rand() * 3));
	if (name === "emptyBody") cfg.body = "";
	if (name === "sizeCap" && !cfg.over) cfg.body = `{"pad":"${"a".repeat(MAX - 10)}"}`;
	return cfg;
}

function serve(ctx: Ctx, name: Name) {
	return createServer((req, res) => {
		ctx.validators[ctx.calls] = req.headers["if-none-match"];
		ctx.calls += 1;
		assert.equal(req.method, "GET");
		assert.equal(req.headers.authorization, undefined);
		assert.equal(req.headers.cookie, undefined);
		assert.equal(req.headers.accept, "application/json");
		res.on("error", () => {});
		res.on("close", () => { ctx.closed = true });
		handlers[name](ctx)(req, res);
	});
}

const SIMPLE: Partial<Record<Name, { expect: unknown; calls: number }>> = {
	truncated: { expect: { outcome: "failed", kind: "network" }, calls: 1 },
	malformed: { expect: { outcome: "failed", kind: "invalid" }, calls: 1 },
	emptyBody: { expect: { outcome: "failed", kind: "invalid" }, calls: 1 },
	mod304NoValidator: { expect: { outcome: "failed", kind: "http" }, calls: 2 },
	status401: { expect: { outcome: "failed", kind: "http" }, calls: 1 },
	status500: { expect: { outcome: "failed", kind: "http" }, calls: 1 },
	hangTimeout: { expect: { outcome: "failed", kind: "timeout" }, calls: 1 },
	resetMidBody: { expect: { outcome: "failed", kind: "network" }, calls: 1 },
	externalAbort: { expect: { outcome: "failed", kind: "disposed" }, calls: 1 },
};

function expect(name: Name, out: unknown, ctx: Ctx, elapsed: number): void {
	const c = ctx.cfg;
	const simple = SIMPLE[name];
	if (simple !== undefined) {
		assert.deepEqual(out, simple.expect);
		assert.equal(ctx.calls, simple.calls);
		if (simple.calls === 2) { assert.equal(ctx.validators[0], undefined); assert.equal(ctx.validators[1], undefined) }
	}
	if (name === "ok200" || name === "chunked200") {
		assert.equal((out as { value?: unknown }).value !== undefined && JSON.stringify((out as { value: unknown }).value), JSON.stringify(JSON.parse(c.body)));
		if (name === "ok200") { assert.equal((out as { etag?: string }).etag, '"wire-v1"'); assert.equal((out as { lastModified?: number }).lastModified, Date.parse(LM)) }
	}
	if (name === "mod304Validator") { assert.deepEqual(out, { outcome: "unchanged" }); assert.equal(ctx.validators[0], '"wire-etag"') }
	if (name === "status404" || name === "status501") { assert.deepEqual(out, { outcome: "no-data" }); assert.equal(ctx.calls, 1) }
	if (name === "rate429") { assert.deepEqual(out, { outcome: "failed", kind: "rate-limit", retryAfterMs: c.secs * 1000 }); assert.equal(ctx.calls, 1) }
	if (name === "hangTimeout") { assert.ok(elapsed >= c.hangMs - 20 && elapsed < 3000, `elapsed=${elapsed} hangMs=${c.hangMs}`); assert.equal(ctx.closed, true) }
	if (name === "externalAbort") { assert.ok(elapsed >= c.abortMs - 20 && elapsed < 3500, `elapsed=${elapsed} abortMs=${c.abortMs}`); assert.equal(ctx.closed, true) }
	if (name === "sizeCap") {
		if (c.over) { assert.deepEqual(out, { outcome: "failed", kind: "invalid" }) } else {
			const pad = (out as { value?: { pad?: string } }).value?.pad;
			assert.deepEqual(out.outcome, "updated");
			assert.equal(pad !== undefined && pad.length, MAX - 10);
		}
		assert.equal(ctx.calls, 1);
	}
}

async function until(cond: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 10)) }
	return cond();
}

async function runCase(name: Name, rep: number, rand: () => number): Promise<string> {
	const cfg = prepare(name, rep, rand);
	const ctx: Ctx = { calls: 0, validators: [], closed: false, cfg };
	const server = serve(ctx, name);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	const ctl = new AbortController();
	const timer = name === "externalAbort" ? setTimeout(() => ctl.abort(), cfg.abortMs) : undefined;
	const t0 = Date.now();
	let out: unknown;
	try {
		out = await fetchOfficialCatalog(fetch, { url: `http://127.0.0.1:${port}/catalog.json`, etag: name === "mod304Validator" ? '"wire-etag"' : undefined, timeoutMs: name === "hangTimeout" ? cfg.hangMs : 4000, signal: ctl.signal });
	} finally { if (timer !== undefined) clearTimeout(timer) }
	const elapsed = Date.now() - t0;
	if ((name === "hangTimeout" || name === "externalAbort") && !ctx.closed) await until(() => ctx.closed, 1500);
	expect(name, out, ctx, elapsed);
	server.closeAllConnections();
	server.close();
	return `${JSON.stringify(out).slice(0, 120)} calls=${ctx.calls} closed=${ctx.closed} elapsedMs=${elapsed}`;
}

process.on("unhandledRejection", (e) => { console.log(`UNHANDLED_REJECTION ${String(e)}`); process.exitCode = 1 });

async function main(): Promise<void> {
	const rand = mulberry32(SEED);
	const failures: string[] = [];
	let idx = 0;
	for (const name of NAMES) {
		for (let rep = 0; rep < 8; rep++) {
			idx += 1;
			try {
				console.log(`[${idx}/128] ${name}#${rep} PASS ${await runCase(name, rep, rand)}`);
			} catch (err) {
				failures.push(`${name}#${rep}: ${err instanceof Error ? err.message : String(err)}`);
				console.log(`[${idx}/128] ${name}#${rep} FAIL ${failures[failures.length - 1]}`);
			}
		}
	}
	console.log(`SUMMARY SEED=${SEED} CASES=${idx} PASS=${idx - failures.length} FAIL=${failures.length}`);
	for (const f of failures) console.log(`FAILURE ${f}`);
	if (failures.length > 0) process.exitCode = 1;
}

void main();
