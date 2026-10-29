import { registerHcNativeTools } from "../src/tools/hc-native-surface.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("every HC-native tool executes for real (write→read→edit→grep→glob round-trip)", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "hcsmoke-"));
	const registered = new Map<string, { execute: (id: string, input: Record<string, unknown>) => Promise<unknown> }>();
	const pi = { registerTool: (t: { name: string; execute: (id: string, input: Record<string, unknown>) => Promise<unknown> }) => registered.set(t.name, t) } as never;
	await registerHcNativeTools(pi, cwd);
	await (registered.get("write")!.execute("w", { filePath: join(cwd, "a.txt"), content: "alpha beta gamma\n" }));
	const read1 = await (registered.get("read")!.execute("r", { filePath: join(cwd, "a.txt") })) as { content: { text: string }[] };
	assert.match(read1.content.map((c) => c.text).join(""), /alpha beta gamma/);
	await (registered.get("edit")!.execute("e", { filePath: join(cwd, "a.txt"), oldString: "beta", newString: "delta" }));
	assert.match(await readFile(join(cwd, "a.txt"), "utf8"), /alpha delta gamma/);
	const grep = await (registered.get("grep")!.execute("g", { pattern: "delta", path: cwd })) as { content: { text: string }[] };
	assert.match(grep.content.map((c) => c.text).join(""), /a\.txt/);
	const glob = await (registered.get("glob")!.execute("gl", { pattern: "*.txt", path: cwd })) as { content: { text: string }[] };
	assert.match(glob.content.map((c) => c.text).join(""), /a\.txt/);
	await rm(cwd, { recursive: true, force: true });
});
