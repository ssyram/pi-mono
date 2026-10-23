import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function parityScenarioOutcome(work: string): Promise<{ main: unknown; child: unknown; files: Record<string, string> }> {
	const deadline = Date.now() + 90000;
	for (;;) {
		let failure: string | undefined;
		try { failure = await readFile(join(work, "parity-failure.json"), "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		assert.equal(failure, undefined, failure);
		try {
			const main = JSON.parse(await readFile(join(work, "parity-main.json"), "utf8")) as unknown;
			const child = JSON.parse(await readFile(join(work, "parity-child.json"), "utf8")) as unknown;
			const files: Record<string, string> = {};
			for (const name of ["main-ok", "child-ready", "child-ping", "release-parity"]) files[name] = await readFile(join(work, name), "utf8");
			for (const name of ["forbidden-child-write", "unexpected-child"]) await assert.rejects(readFile(join(work, name)), { code: "ENOENT" });
			return { main, child, files };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || Date.now() >= deadline) throw error;
		}
		await delay(40);
	}
}
