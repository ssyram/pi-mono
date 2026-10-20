import assert from "node:assert/strict";
import fs, { type PathOrFileDescriptor } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import lockfile from "proper-lockfile";
import { SharedDefinitionStore } from "../src/v2/definition-store.js";
import { describeSchedule } from "../src/v2/format-list.js";
import {
	assertTaskInput,
	type SharedDefinition,
	type SharedRegistrationIndex,
} from "../src/v2/model.js";
import { validOnceTime } from "../src/v2/valid-once-time.js";

const definition = {
	id: "workspace:one",
	scope: "workspace" as const,
	prompt: "x",
	schedule: { kind: "once" as const, runAt: 2000 },
	createdAt: 1000,
};

test("new once schedules use Date domain, while old out-of-range data stays displayable", () => {
	assert.equal(validOnceTime(8_640_000_000_000_000), true);
	assert.equal(validOnceTime(8_640_000_000_000_001), false);
	assert.doesNotThrow(() =>
		assertTaskInput({
			prompt: "edge",
			schedule: { kind: "once", runAt: 8_640_000_000_000_000 },
		}),
	);
	assert.throws(
		() =>
			assertTaskInput({
				prompt: "past date domain",
				schedule: { kind: "once", runAt: 8_700_000_000_000_000 },
			}),
		/Date range/,
	);
	assert.equal(
		describeSchedule({ kind: "once", runAt: 8_700_000_000_000_000 }),
		"once at epoch-ms 8700000000000000",
	);
});

test("failed rename cleans its own temporary and preserves the original failure", (t) => {
	const root = fs.mkdtempSync(join(tmpdir(), "loop-store-cleanup-"));
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		fs.rmSync(root, { recursive: true, force: true });
	});
	const original = new Error("rename denied");
	t.mock.method(fs, "renameSync", () => {
		throw original;
	});
	syncBuiltinESMExports();
	const store = new SharedDefinitionStore(root, root);
	assert.throws(
		() => store.create(definition),
		(error) => error === original,
	);
	const directory = join(root, ".pi", "scheduled-wakeup", "v2");
	assert.deepEqual(fs.readdirSync(directory), []);
	const release = lockfile.lockSync(
		join(directory, "workspace-definitions.json"),
		{ realpath: false },
	);
	release();
});

test("partial write failure cleans temporary and preserves the primary failure", (t) => {
	const root = fs.mkdtempSync(join(tmpdir(), "loop-store-write-"));
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		fs.rmSync(root, { recursive: true, force: true });
	});
	const write = fs.writeFileSync.bind(fs);
	const original = Object.assign(new Error("file limit"), { code: "EFBIG" });
	t.mock.method(fs, "writeFileSync", (path: PathOrFileDescriptor) => {
		write(path, "partial");
		throw original;
	});
	syncBuiltinESMExports();
	assert.throws(
		() => new SharedDefinitionStore(root, root).create(definition),
		(error) => error === original,
	);
	assert.deepEqual(
		fs.readdirSync(join(root, ".pi", "scheduled-wakeup", "v2")),
		[],
	);
	const release = lockfile.lockSync(
		join(root, ".pi", "scheduled-wakeup", "v2", "workspace-definitions.json"),
		{ realpath: false },
	);
	release();
});

test("catalog rejects duplicate session/registration pairs across definitions", (t) => {
	const root = fs.mkdtempSync(join(tmpdir(), "loop-store-index-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const store = new SharedDefinitionStore(root, root);
	store.create(definition);
	store.create({ ...definition, id: "workspace:two" });
	const path = join(
		root,
		".pi",
		"scheduled-wakeup",
		"v2",
		"workspace-definitions.json",
	);
	const catalog = JSON.parse(fs.readFileSync(path, "utf8")) as {
		version: number;
		definitions: SharedDefinition[];
		registrations: SharedRegistrationIndex[];
	};
	catalog.registrations = ["workspace:one", "workspace:two"].map(
		(definitionId) => ({
			scope: "workspace",
			definitionId,
			sessionId: "same-session",
			registrationId: "same-registration",
			registeredAt: 1000,
		}),
	);
	fs.writeFileSync(path, JSON.stringify(catalog));
	const first = catalog.registrations[0];
	assert.ok(first);
	assert.equal(store.registrationStatus(first), "unavailable");
});
