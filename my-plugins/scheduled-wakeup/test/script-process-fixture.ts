import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { ScriptSpec } from "../src/script-tasks/task-spec.js";

export async function createScriptDirectory(t: TestContext): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "loop-script-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

export function nodeScript(
	cwd: string,
	code: string,
	timeoutSeconds: number | null = 2,
): ScriptSpec {
	return { cwd, path: process.execPath, params: ["-e", code], timeoutSeconds };
}
