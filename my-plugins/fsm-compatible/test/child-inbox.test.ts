import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureChildMetadata, enqueueInboxMessage, inboxDir, registerChildRuntime } from "../src/children/child-inbox.ts";
import { patchChildMetadata, readChildMetadata, childStateOr } from "../src/children/child-metadata.ts";
import type { NativeChildBootstrap } from "../src/children/native-child-bootstrap.ts";

test("metadata roundtrip patches fields atomically and keeps version stamped", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "child-meta-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	await ensureChildMetadata(dir, { sessionId: "ses_a", parentSessionId: "root", rootSessionId: "root", tmuxSession: "fsm-ses_a",
		cwd: "/w", model: "m", thinking: "off", launchArgs: [], extraArgs: [], state: "starting", hasStarted: false,
		outcome: null, summary: "" });
	await patchChildMetadata(dir, { state: "busy" });
	const after = await readChildMetadata(dir);
	assert.equal(after?.state, "busy");
	assert.equal(after?.sessionId, "ses_a");
	assert.notEqual(after?.updatedAt, after?.createdAt);
	assert.equal(await childStateOr(dir, "error"), "busy");
	assert.equal(await childStateOr(join(dir, "missing"), "error"), "error");
});

test("inbox poller delivers via sendUserMessage, unlinks on success, skips invalid", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "child-inbox-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	await ensureChildMetadata(dir, { sessionId: "ses_b", parentSessionId: "root", rootSessionId: "root", tmuxSession: "fsm-ses_b",
		cwd: "/w", model: "m", thinking: "off", launchArgs: [], extraArgs: [], state: "idle", hasStarted: true,
		outcome: null, summary: "" });
	await writeFile(join(dir, "bootstrap.json"), "{}", { mode: 0o600 });
	const delivered: Array<{ message: string; options?: { deliverAs?: "steer" | "followUp" } | undefined }> = [];
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	let idle = true;
	const pi = {
		sendUserMessage: (message: string, options: { deliverAs?: "steer" | "followUp" } | undefined) => { delivered.push({ message, options }); },
		on: (name: string, handler: (event: never, ctx: never) => unknown) => { handlers.set(name, handler); return () => handlers.delete(name); },
	} as unknown as ExtensionAPI;
	const bootstrap = { binding: { version: 1 as const, kind: "execution-child" as const, rootSessionId: "root", sessionId: "ses_b",
		agentId: "ses_b", agentName: "general", parentSessionId: "root", depth: 1, createdAt: "2026-10-22T00:00:00Z" },
		coordinatorUrl: "http://127.0.0.1:1", token: "x", depth: 1, bridgePassword: "x", extensionPath: join(dir, "extensions.ts") };
	const off = registerChildRuntime(pi, bootstrap as unknown as NativeChildBootstrap);
	t.after(off);
	const context = { isIdle: () => idle, sessionManager: { getSessionId: () => "ses_b" } } as unknown as ExtensionContext;
	(handlers.get("session_start") as (event: unknown, ctx: ExtensionContext) => unknown)(undefined as never, context);

	await enqueueInboxMessage(dir, "first task");
	await writeFile(join(inboxDir(dir), "zz-invalid.json"), "{corrupt", { mode: 0o600 });
	await delay(700);
	assert.deepEqual(delivered.map((entry) => entry.message), ["first task"]);
	assert.equal(delivered[0]!.options, undefined, "idle delivery has no deliverAs");
	const remaining = await (await import("node:fs/promises")).readdir(inboxDir(dir));
	assert.equal(remaining.length, 0, "valid delivered + invalid skipped, both unlinked");
	assert.equal((await readChildMetadata(dir))?.error?.includes("invalid inbox"), true);

	idle = false;
	await enqueueInboxMessage(dir, "steer this", "followUp");
	await delay(700);
	assert.deepEqual(delivered.at(-1), { message: "steer this", options: { deliverAs: "followUp" } });

	(handlers.get("session_shutdown") as (event: { reason: string }) => unknown)({ reason: "quit" });
	await delay(300);
	assert.equal((await readChildMetadata(dir))?.state, "exited");
	await enqueueInboxMessage(dir, "after shutdown");
	await delay(400);
	assert.equal(delivered.length, 2, "poller stopped after shutdown");
});
