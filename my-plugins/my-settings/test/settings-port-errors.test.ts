import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { createMySettingsClient } from "../client.ts";
import mySettings from "../extension.ts";
import type { SettingsResult } from "../protocol.ts";
import { settingsFixture } from "./settings-fixture.ts";

function errorCode(result: SettingsResult): string {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected error result");
	return result.error.code;
}

function silenceDiagnostics(t: { after(callback: () => void): void }) {
	const original = console.error;
	console.error = () => {};
	t.after(() => {
		console.error = original;
	});
}

test("Pi port failures become explicit errors, including committed files with a failed log", async (t) => {
	silenceDiagnostics(t);
	const paths = await settingsFixture(t);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = paths.globalRoot;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	const bus = createEventBus();
	const handlers = new Map<string, (event: unknown, context: ExtensionContext) => void>();
	const manager = { getSessionId: () => "id", getBranch: () => [] };
	const context = {
		cwd: paths.cwd,
		sessionManager: manager,
	} as unknown as ExtensionContext;
	const pi = {
		events: bus,
		on(name: string, handler: (event: unknown, context: ExtensionContext) => void) {
			handlers.set(name, handler);
		},
		appendEntry() {
			throw new Error("native append failure");
		},
		registerCommand() {},
	} as unknown as ExtensionAPI;
	mySettings(pi);
	assert.doesNotThrow(() => handlers.get("session_start")?.({}, context));
	const client = createMySettingsClient(bus, {
		session: manager,
		sessionId: "id",
	});
	manager.getSessionId = () => {
		throw new Error("native ID failure");
	};
	assert.equal(errorCode(await client.saveSession({ values: {} })), "OPERATION_FAILED");
	manager.getSessionId = () => "id";
	manager.getBranch = () => {
		throw new Error("native branch failure");
	};
	assert.equal((await client.query({ defaults: {} })).ok, true);
	assert.equal(errorCode(await client.saveSession({ values: {} })), "OPERATION_FAILED");
	assert.equal(errorCode(await client.saveGlobalAndSession({ values: { enabled: false } })), "OPERATION_FAILED");
	assert.deepEqual(JSON.parse(await readFile(join(paths.globalRoot, "settings.json"), "utf8")), { enabled: false });
});
