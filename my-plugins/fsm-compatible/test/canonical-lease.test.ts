import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { acquireCanonicalLease } from "../src/coordination/canonical-lease.ts";

const host = { pid: 42, startId: "100" };
async function scopeFor(t: { after(callback: () => Promise<void> | void): void }) {
	const base = fileURLToPath(new URL("./.tmp/", import.meta.url));
	await mkdir(base, { recursive: true });
	const directory = await mkdtemp(join(base, "lease-"));
	const timer = setInterval(() => {}, 1000);
	t.after(async () => { clearInterval(timer); await rm(directory, { recursive: true, force: true }); });
	return join(directory, "coord");
}

test("same physical host/canonical key serializes different root callers", async (t) => {
	const scope = await scopeFor(t);
	const first = await acquireCanonicalLease(scope, host, "fsm_get_state", "root-a", Date.now() + 2000);
	let entered = false;
	const secondPromise = acquireCanonicalLease(scope, host, "fsm_get_state", "root-b", Date.now() + 2000).then((lease) => { entered = true; return lease; });
	await delay(40);
	assert.equal(entered, false);
	await first.release();
	const second = await secondPromise;
	assert.equal(entered, true);
	await second.release();
	await second.release();
});

test("different canonical tools and process generations do not share a lease", async (t) => {
	const scope = await scopeFor(t);
	const first = await acquireCanonicalLease(scope, host, "a", "r", Date.now() + 1000);
	const different = await acquireCanonicalLease(scope, host, "b", "r", Date.now() + 1000);
	const generation = await acquireCanonicalLease(scope, { ...host, startId: "101" }, "a", "r", Date.now() + 1000);
	assert.notEqual(first.path, different.path);
	assert.notEqual(first.path, generation.path);
	await first.release(); await different.release(); await generation.release();
});

test("waiting cancellation and deadline do not steal a held lease", async (t) => {
	const scope = await scopeFor(t);
	const first = await acquireCanonicalLease(scope, host, "a", "r", Date.now() + 1000);
	const before = await readFile(join(first.path, "owner.json"), "utf8");
	const abort = new AbortController();
	const pending = acquireCanonicalLease(scope, host, "a", "other", Date.now() + 1000, abort.signal);
	abort.abort();
	await assert.rejects(pending, { code: "cancelled" });
	await assert.rejects(acquireCanonicalLease(scope, host, "a", "other", Date.now() + 30), { code: "deadline-exceeded" });
	assert.equal(await readFile(join(first.path, "owner.json"), "utf8"), before);
	await first.release();
});

test("foreign ownership token cannot be released", async (t) => {
	const scope = await scopeFor(t);
	const first = await acquireCanonicalLease(scope, host, "a", "r", Date.now() + 1000);
	await writeFile(join(first.path, "owner.json"), JSON.stringify({ token: "foreign" }));
	await assert.rejects(first.release(), { code: "protocol-invalid" });
	assert.equal(JSON.parse(await readFile(join(first.path, "owner.json"), "utf8")).token, "foreign");
});
