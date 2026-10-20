import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJudgeFileTools } from "../src/judge/judge-file-tools.ts";
import { RuntimeError } from "../src/runtime/runtime-error.ts";

async function sandbox(): Promise<string> {
	return mkdtemp(join(tmpdir(), "fsm-judge-"));
}

test("directory read paginates the real sorted listing with OC semantics", async (t) => {
	const dir = await sandbox();
	t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(join(dir, "nested"));
	for (const name of ["b.txt", "a.txt", "c.md"]) await writeFile(join(dir, name), `${name}\n`);
	await symlink(join(dir, "nested"), join(dir, "zlink"));
	await symlink(join(dir, "missing"), join(dir, "badlink"));
	const tools = createJudgeFileTools(dir, false);
	const full = await tools.read({ filePath: dir });
	assert.ok(full.details && typeof full.details === "object");
	const details = full.details as { entries: string[]; totalEntries: number; truncated: boolean };
	assert.deepEqual(details.entries, ["a.txt", "b.txt", "badlink", "c.md", "nested/", "zlink/"]);
	assert.equal(details.totalEntries, 6);
	const second = await tools.read({ filePath: dir, offset: 2, limit: 1 });
	assert.deepEqual((second.details as { entries: string[] }).entries, ["b.txt"]);
	const emptyWindow = await tools.read({ filePath: dir, offset: 99, limit: 3 });
	assert.deepEqual((emptyWindow.details as { entries: string[] }).entries, []);
	const zeroLimit = await tools.read({ filePath: dir, limit: 0 });
	assert.deepEqual((zeroLimit.details as { entries: string[] }).entries, []);
});

test("file read keeps 1-indexed offsets and grep/glob/bash run against the real tree", async (t) => {
	const dir = await sandbox();
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "lines.txt"), "one\ntwo\nthree\nfour\n");
	await mkdir(join(dir, "sub"));
	await writeFile(join(dir, "sub", "deep.txt"), "needle here\n");
	const tools = createJudgeFileTools(dir, false);
	const slice = await tools.read({ filePath: "lines.txt", offset: 2, limit: 2 });
	assert.match(slice.content, /two/);
	assert.doesNotMatch(slice.content, /one/);
	assert.equal(slice.isError, false);
	const grep = await tools.grep({ pattern: "needle" });
	assert.match(grep.content, /deep\.txt/);
	const glob = await tools.glob({ pattern: "*.txt" });
	assert.match(glob.content, /lines\.txt/);
	const bash = await tools.bash({ command: "pwd", workdir: join(dir, "sub") });
	assert.match(bash.content, new RegExp(join(dir, "sub")));
	assert.equal((await tools.bash({ command: "echo hi", timeout: 5000 })).isError, false);
});

test("edit covers native replacement, replaceAll, empty-old creation and rejects misuse", async (t) => {
	const dir = await sandbox();
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "a.txt"), "alpha alpha alpha\n");
	const tools = createJudgeFileTools(dir, false);
	const native = await tools.edit({ filePath: "a.txt", oldString: "alpha alpha alpha", newString: "beta beta beta" });
	assert.equal(native.isError, false);
	assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "beta beta beta\n");
	await writeFile(join(dir, "b.txt"), "x-x-x\n");
	const all = await tools.edit({ filePath: "b.txt", oldString: "x", newString: "y", replaceAll: true });
	assert.equal(all.isError, false);
	assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "y-y-y\n");
	const zeroMatch = await tools.edit({ filePath: "b.txt", oldString: "nope", newString: "z", replaceAll: true });
	assert.equal(zeroMatch.isError, true);
	const created = await tools.edit({ filePath: "new/dir/c.txt", oldString: "", newString: "fresh" });
	assert.equal(created.isError, false);
	assert.equal(await readFile(join(dir, "new/dir/c.txt"), "utf8"), "fresh");
	const exists = await tools.edit({ filePath: "a.txt", oldString: "", newString: "over" });
	assert.equal(exists.isError, true);
	assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "beta beta beta\n");
	const identical = await tools.edit({ filePath: "a.txt", oldString: "same", newString: "same" });
	assert.equal(identical.isError, true);
});

test("paths outside the judge cwd are denied unless external_directory is granted", async (t) => {
	const dir = await sandbox();
	const outside = await sandbox();
	t.after(async () => { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
	await writeFile(join(outside, "secret.txt"), "secret\n");
	const scoped = createJudgeFileTools(dir, false);
	await assert.rejects(scoped.read({ filePath: join(outside, "secret.txt") }), { code: "protocol-invalid" });
	const open = createJudgeFileTools(dir, true);
	const result = await open.read({ filePath: join(outside, "secret.txt") });
	assert.match(result.content, /secret/);
});
