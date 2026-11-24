import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runBackendInit } from "../src/backend-init.js";
import type { BootstrapState } from "../src/backend-bootstrap.js";

const root = await mkdtemp(join(tmpdir(), "throttle-zai-init-"));
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

const state: BootstrapState = {
	version: 1,
	instanceId: "11111111-1111-1111-1111-111111111111",
	adminUsername: "qt-owner",
	adminPassword: "pw",
};
const control = "http://127.0.0.1:3001";
const relay = "http://127.0.0.1:3000";

async function script(name: string, body: string): Promise<string> {
	const path = join(root, name);
	await writeFile(path, `#!/usr/bin/env node\nimport { stdin } from "node:process";\nstdin.resume();\n${body}\n`, "utf-8");
	await chmod(path, 0o755);
	return path;
}

describe("runBackendInit", () => {
	it("returns created for a v1 manifest with matching identity", async () => {
		const path = await script(
			"ok.mjs",
			`process.stdout.write(JSON.stringify({version:1,kind:"created",instanceId:"${state.instanceId}",controlUrl:"${control}",relayBaseUrl:"${relay}"}));`,
		);
		const plan = { kind: "personal" };
		const seed = { name: "acct-x", apiKey: "k" };
		const direct = await runBackendInit(path, join(root, "config.toml"), state, control, relay, plan, seed);
		expect(direct).toMatchObject({ kind: "ok", value: { kind: "created" } });
	});

	it("maps error codes, bad identity, non-JSON and missing binary", async () => {
		const plan = { kind: "personal" };
		const seed = { name: "acct-x", apiKey: "k" };
		const errorScript = await script("err.mjs", `process.stdout.write(JSON.stringify({version:1,kind:"error",code:"quota-probe"}));`);
		expect(await runBackendInit(errorScript, join(root, "c1.toml"), state, control, relay, plan, seed)).toMatchObject({ kind: "error", code: "quota-probe" });
		const wrongIdentity = await script("wrong.mjs", `process.stdout.write(JSON.stringify({version:1,kind:"existing",instanceId:"other",controlUrl:"${control}",relayBaseUrl:"${relay}"}));`);
		expect(await runBackendInit(wrongIdentity, join(root, "c2.toml"), state, control, relay, plan, seed)).toMatchObject({ kind: "error", code: "identity-conflict" });
		const garbage = await script("garbage.mjs", `process.stdout.write("not json");`);
		expect(await runBackendInit(garbage, join(root, "c3.toml"), state, control, relay, plan, seed)).toMatchObject({ kind: "error", code: "unsupported-backend" });
		expect(await runBackendInit(join(root, "missing.mjs"), join(root, "c4.toml"), state, control, relay, plan, seed)).toMatchObject({ kind: "error", code: "configuration" });
	});

	it("times out hung init and reports timeout", async () => {
		const hung = await script("hung.mjs", `setTimeout(() => {}, 60000);`);
		const result = await runBackendInit(hung, join(root, "c5.toml"), state, control, relay, { kind: "personal" }, { name: "acct-x", apiKey: "k" });
		expect(result).toMatchObject({ kind: "error", code: "timeout" });
	}, 25_000);
});
