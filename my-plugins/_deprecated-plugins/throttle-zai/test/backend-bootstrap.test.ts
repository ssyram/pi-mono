import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBootstrapState, loadBootstrapState, readPrivateJson, writePrivateJson } from "../src/backend-bootstrap.js";

const root = await mkdtemp(join(tmpdir(), "throttle-zai-state-"));
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("bootstrap state", () => {
	it("reports uninitialized when missing and storage errors when corrupt", async () => {
		const missing = await loadBootstrapState(join(root, "none.json"));
		expect(missing).toMatchObject({ kind: "error", code: "uninitialized" });
		const corrupt = join(root, "corrupt.json");
		await writeFile(corrupt, "{oops", { mode: 0o600 });
		expect(await loadBootstrapState(corrupt)).toMatchObject({ kind: "error", code: "storage" });
		await writeFile(join(root, "bad.json"), JSON.stringify({ version: 2 }), { mode: 0o600 });
		expect(await loadBootstrapState(join(root, "bad.json"))).toMatchObject({ kind: "error", code: "storage" });
	});

	it("publishes exclusively: creator and loser converge on one identity at 0600", async () => {
		const path = join(root, "state", "bootstrap.json");
		const [first, second] = await Promise.all([createBootstrapState(path), createBootstrapState(path)]);
		expect(first.kind).toBe("ok");
		expect(second.kind).toBe("ok");
		if (first.kind !== "ok" || second.kind !== "ok") throw new Error("unreachable");
		expect(second.value.instanceId).toBe(first.value.instanceId);
		const loaded = await loadBootstrapState(path);
		if (loaded.kind !== "ok") throw new Error("load failed");
		expect(loaded.value.instanceId).toBe(first.value.instanceId);
		expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
	});

	it("private json read/write roundtrip with restricted mode", async () => {
		const path = join(root, "clients", "journal.json");
		const written = await writePrivateJson(path, { kind: "ready", name: "qt-x", tokenId: 7 });
		expect(written.kind).toBe("ok");
		expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
		const loaded = await readPrivateJson(path);
		expect(loaded).toMatchObject({ kind: "ok", value: { tokenId: 7 } });
		await rm(path);
		const fresh = await readPrivateJson(path);
		expect(fresh).toMatchObject({ kind: "error", code: "uninitialized" });
		await readFile(path, "utf-8").catch(() => undefined);
	});
});
