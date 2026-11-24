import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./check-deps-fresh.mjs", import.meta.url));

async function withRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pi-deps-fresh-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "node_modules"), { recursive: true });
	return root;
}

async function writeLocks(root, lockPackages, snapshotPackages) {
	await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: lockPackages }));
	await writeFile(join(root, "node_modules/.package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: snapshotPackages }));
}

test("passes when the snapshot matches the lockfile and absent optionals are tolerated", async (t) => {
	const root = await withRoot(t);
	await writeLocks(
		root,
		{
			"": { name: "root", version: "1.0.0" },
			"node_modules/zod": { version: "4.6.7" },
			"node_modules/fsevents": { version: "2.3.3", optional: true },
		},
		{ "": { name: "root", version: "1.0.0" }, "node_modules/zod": { version: "4.6.7" } },
	);
	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
});

test("fails on version drift, missing packages, and leftovers with an actionable message", async (t) => {
	const root = await withRoot(t);
	await writeLocks(
		root,
		{ "": {}, "node_modules/zod": { version: "4.6.7" }, "node_modules/ajv": { version: "8.20.0" } },
		{ "": {}, "node_modules/zod": { version: "3.25.76" }, "node_modules/stale-extra": { version: "1.0.0" } },
	);
	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /node_modules is out of sync/);
	assert.match(result.stderr, /Run: npm install --ignore-scripts/);
	assert.match(result.stderr, /node_modules\/zod: node_modules has 3\.25\.76, lockfile has 4\.6\.7/);
	assert.match(result.stderr, /node_modules\/ajv@8\.20\.0 is missing from node_modules/);
	assert.match(result.stderr, /node_modules\/stale-extra is installed but absent from the lockfile/);
});

test("fails when node_modules or its npm snapshot is absent", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-deps-fresh-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "package-lock.json"), JSON.stringify({ packages: {} }));
	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no npm snapshot/);
});
