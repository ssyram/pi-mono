import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { SharedDefinitionStore } from "../src/v2/definition-store.js";
import {
	formatActiveTasks,
	formatAvailableDefinitions,
} from "../src/v2/format-list.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type {
	SessionEntryLike,
	SessionEntryPort,
} from "../src/v2/session-entry-adapter.js";
import { UserLoopV2Commands } from "../src/v2/user-commands.js";

const NOW = 10_000;

describe("Loop 2.0 scopes and registrations", () => {
	it("keeps AI actions session-only while explicit user commands define and register shared work", async () => {
		const roots = createRoots();
		const journal = createJournal();
		const core = createCore("session-a", journal.port, roots);
		const ai = new AiSessionActions(core);
		const user = new UserLoopV2Commands(core);

		const denied = await ai.execute({
			action: "add",
			scope: "global",
			prompt: "escalate",
			schedule: { kind: "once", runAt: NOW },
		});
		assert.equal(denied.ok, false);
		assert.match(denied.message, /do not accept scope/);
		assert.deepEqual(core.listAvailable(), []);

		const local = await ai.execute({
			action: "add",
			prompt: "session work",
			schedule: { kind: "once", runAt: NOW },
		});
		assert.equal(local.ok, true);
		assert.ok(local.active);
		assert.equal(local.active[0]?.kind, "session");

		const workspace = user.defineSharedTask("workspace", {
			prompt: "workspace work",
			schedule: { kind: "interval", intervalMs: 500 },
		});
		const global = user.defineSharedTask("global", {
			prompt: "global work",
			schedule: { kind: "once", runAt: NOW },
		});
		const available = user.listAvailable();
		assert.deepEqual(
			available.map((definition) => definition.id).sort(),
			[global.id, workspace.id].sort(),
		);
		assert.equal(core.snapshotSessionState().registrations.length, 0);
		assert.equal(
			core.listActive().filter((item) => item.kind === "registration").length,
			0,
		);

		const registration = user.registerSharedTask("workspace", workspace.id);
		const stateAfterRegistration = core.snapshotSessionState();
		assert.equal(stateAfterRegistration.tasks.length, 1);
		assert.equal(
			Object.hasOwn(stateAfterRegistration.registrations[0] ?? {}, "prompt"),
			false,
		);
		assert.equal(
			Object.hasOwn(stateAfterRegistration.registrations[0] ?? {}, "schedule"),
			false,
		);
		assert.equal(
			core
				.listActive()
				.some(
					(item) =>
						item.kind === "registration" &&
						item.registration.id === registration.id,
				),
			true,
		);
		assert.deepEqual(
			user.listAvailable().map((definition) => definition.id),
			[global.id],
		);
		assert.equal(
			existsSync(
				join(
					roots.workspace,
					".pi",
					"scheduled-wakeup",
					"v2",
					"workspace-definitions.json",
				),
			),
			true,
		);
		assert.equal(
			existsSync(
				join(
					roots.global,
					".pi",
					"scheduled-wakeup",
					"v2",
					"global-definitions.json",
				),
			),
			true,
		);
	});

	it("stores optional names, renames tasks and shared definitions, and displays them", () => {
		const roots = createRoots();
		const journal = createJournal();
		const core = createCore("named", journal.port, roots);
		const user = new UserLoopV2Commands(core);

		const named = core.createSessionTask({
			prompt: "named work",
			schedule: { kind: "interval", intervalMs: 500 },
			name: "  spaced  ",
		});
		assert.equal(named.name, "spaced");
		assert.equal(
			createCore("named", journal.port, roots).snapshotSessionState().tasks[0]
				?.definition.name,
			"spaced",
		);
		assert.equal(core.renameSessionTask(named.id, "renamed")?.name, "renamed");
		assert.equal(
			createCore("named", journal.port, roots).snapshotSessionState().tasks[0]
				?.definition.name,
			"renamed",
		);
		assert.throws(
			() =>
				core.createSessionTask({
					prompt: "bad name",
					schedule: { kind: "interval", intervalMs: 500 },
					name: "   ",
				}),
			/name must be a non-empty string/,
		);
		assert.equal(core.renameSessionTask("session:missing", "x"), undefined);

		const definition = user.defineSharedTask("global", {
			prompt: "shared named",
			schedule: { kind: "once", runAt: NOW },
			name: "shared name",
		});
		assert.equal(definition.name, "shared name");
		const other = createCore("other", createJournal().port, roots);
		assert.equal(other.listDefinitions(["global"])[0]?.name, "shared name");
		assert.match(
			formatAvailableDefinitions(other.listAvailable(["global"])),
			/shared name \[global:/,
		);
		other.registerSharedDefinition("global", definition.id);
		assert.match(
			formatActiveTasks(other.listActive(), [], new Map(), NOW),
			/shared name \[registration:/,
		);
		assert.equal(
			other.renameSharedDefinition("global", definition.id, undefined)?.name,
			undefined,
		);
		assert.equal(
			other.renameSharedDefinition("global", "global:missing", "x"),
			undefined,
		);
		assert.equal(other.listDefinitions(["global"])[0]?.name, undefined);
	});

	it("rejects a shared document containing a definition for another scope", () => {
		const roots = createRoots();
		const documentPath = join(
			roots.workspace,
			".pi",
			"scheduled-wakeup",
			"v2",
			"workspace-definitions.json",
		);
		mkdirSync(join(roots.workspace, ".pi", "scheduled-wakeup", "v2"), {
			recursive: true,
		});
		writeFileSync(
			documentPath,
			`${JSON.stringify({
				version: 2,
				definitions: [
					{
						id: "workspace:valid",
						scope: "workspace",
						prompt: "valid workspace definition",
						schedule: { kind: "once", runAt: NOW },
						createdAt: NOW,
					},
					{
						id: "global:misplaced",
						scope: "global",
						prompt: "misplaced global definition",
						schedule: { kind: "once", runAt: NOW },
						createdAt: NOW,
					},
				],
				registrations: [],
			})}\n`,
			"utf8",
		);

		const definitions = new SharedDefinitionStore(
			roots.workspace,
			roots.global,
		);
		assert.deepEqual(definitions.list("workspace"), []);
		assert.equal(definitions.get("workspace", "workspace:valid"), undefined);
	});

	it("keeps an active registration listed when its shared document is corrupt", () => {
		const roots = createRoots();
		const journal = createJournal();
		const core = createCore("session-unavailable", journal.port, roots);
		const definition = core.createSharedDefinition("workspace", {
			prompt: "workspace work",
			schedule: { kind: "once", runAt: NOW },
		});
		const registration = core.registerSharedDefinition(
			"workspace",
			definition.id,
		);
		const documentPath = join(
			roots.workspace,
			".pi",
			"scheduled-wakeup",
			"v2",
			"workspace-definitions.json",
		);
		assert.match(readFileSync(documentPath, "utf8"), /workspace work/);
		writeFileSync(documentPath, "{", "utf8");

		const active = core.listActive();
		assert.equal(active.length, 1);
		assert.equal(
			active.some(
				(item) =>
					item.kind === "registration" &&
					item.registration.id === registration.id &&
					item.definition === undefined,
			),
			true,
		);
		assert.deepEqual(core.reconcileSharedRegistrations(), []);
		assert.equal(core.snapshotSessionState().registrations.length, 1);
	});

	it("keeps registration relationships and progress isolated across sessions", () => {
		const roots = createRoots();
		const firstJournal = createJournal();
		const first = createCore("session-one", firstJournal.port, roots);
		const owner = new UserLoopV2Commands(first);
		const definition = owner.defineSharedTask("global", {
			prompt: "shared",
			schedule: { kind: "once", runAt: NOW },
		});
		const firstRegistration = owner.registerSharedTask("global", definition.id);

		const secondJournal = createJournal();
		const second = createCore("session-two", secondJournal.port, roots);
		const secondCommands = new UserLoopV2Commands(second);
		assert.deepEqual(
			secondCommands.listAvailable(["global"]).map((candidate) => candidate.id),
			[definition.id],
		);
		const secondRegistration = secondCommands.registerSharedTask(
			"global",
			definition.id,
		);

		assert.notEqual(firstRegistration.id, "");
		assert.notEqual(secondRegistration.id, "");
		assert.equal(
			first.executeRegistration(firstRegistration.id, () => undefined).kind,
			"executed",
		);
		assert.equal(
			first.snapshotSessionState().registrations[0]?.progress.runCount,
			1,
		);
		assert.equal(
			second.snapshotSessionState().registrations[0]?.progress.runCount,
			0,
		);
		assert.equal(
			second.executeRegistration(secondRegistration.id, () => undefined).kind,
			"executed",
		);
		assert.equal(
			second.snapshotSessionState().registrations[0]?.progress.runCount,
			1,
		);
	});
});

type Roots = { workspace: string; global: string };

function createRoots(): Roots {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-v2-"));
	return { workspace: join(root, "workspace"), global: join(root, "global") };
}

function createCore(
	sessionId: string,
	sessionEntries: SessionEntryPort,
	roots: Roots,
): LoopV2Core {
	return new LoopV2Core({
		sessionId,
		sessionEntries,
		workspaceRoot: roots.workspace,
		globalRoot: roots.global,
		now: () => NOW,
	});
}

function createJournal(): {
	entries: SessionEntryLike[];
	port: SessionEntryPort;
} {
	const entries: SessionEntryLike[] = [];
	return {
		entries,
		port: {
			getBranch: () => entries,
			appendEntry: (customType, data) => {
				entries.push({ type: "custom", customType, data });
			},
		},
	};
}
