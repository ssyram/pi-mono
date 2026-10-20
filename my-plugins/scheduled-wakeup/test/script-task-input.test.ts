import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LoopV2Core } from "../src/v2/loop-core.js";
import { parseLoopV2Command } from "../src/v2/parse-v2-command.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";
import { parseSessionLoopState } from "../src/v2/session-state-codec.js";
import { cloneTaskContent } from "../src/v2/task-content.js";

test("script CLI preserves argv spaces, defaults and literals after the schedule", () => {
	const parsed = parseLoopV2Command(
		'add --script {"path":"./one","params":["a  b","}"]} --script {"path":"./two","timeoutSeconds":null} --wake on-error 10m explain --script literally',
		1000,
		"/work",
	);
	assert.equal(parsed.kind, "add");
	if (parsed.kind !== "add") return;
	assert.ok(parsed.scriptTask);
	assert.deepEqual(parsed.scriptTask.scripts[0]?.params, ["a  b", "}"]);
	assert.equal(parsed.scriptTask.scripts[0]?.path, "/work/one");
	assert.equal(parsed.scriptTask.scripts[0]?.timeoutSeconds, 1800);
	assert.equal(parsed.scriptTask.scripts[1]?.timeoutSeconds, null);
	assert.deepEqual(parsed.scriptTask.wakeUp, {
		kind: "on-error",
		aggregation: "or",
		prompt: "explain --script literally",
	});
	const copied = cloneTaskContent(parsed);
	assert.notEqual(
		copied.scriptTask?.scripts[0]?.params,
		parsed.scriptTask.scripts[0]?.params,
	);
});

test("invalid options and non-actionable script tasks return errors", () => {
	for (const raw of [
		"add --script { 1m x",
		"add --script {} 1m x",
		"add --wake never 1m",
		"add --error-mode and 1m x",
		'add --script {"path":"x"} --wake invalid 1m x',
	]) {
		assert.equal(parseLoopV2Command(raw, 1000, "/work").kind, "error", raw);
	}
});

test("session and shared definitions round-trip script payloads without executing them", (t) => {
	const root = mkdtempSync(join(tmpdir(), "loop-script-input-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const entries: SessionEntryLike[] = [];
	const options = {
		sessionId: "script-input",
		workspaceRoot: root,
		globalRoot: root,
		now: () => 1000,
		sessionEntries: {
			getBranch: () => entries,
			appendEntry: (customType: string, data: unknown) => {
				entries.push({ type: "custom", customType, data });
			},
		},
	};
	const core = new LoopV2Core(options);
	const command = parseLoopV2Command(
		'add --script {"path":"missing-script"} --wake never 1m',
		1000,
		root,
	);
	assert.equal(command.kind, "add");
	if (command.kind !== "add") return;
	core.createSessionTask(command);
	core.createSharedDefinition("workspace", command);
	assert.equal(new LoopV2Core(options).listActive()[0]?.kind, "session");
	assert.equal(
		core.listAvailable()[0]?.scriptTask?.scripts[0]?.path,
		join(root, "missing-script"),
	);
	assert.equal(
		parseSessionLoopState(entries.at(-1)?.data)?.tasks[0]?.definition.scriptTask
			?.wakeUp.kind,
		"never",
	);
});
