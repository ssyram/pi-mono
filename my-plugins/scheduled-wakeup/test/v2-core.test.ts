import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { SharedDefinitionStore } from "../src/v2/definition-store.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";
import { UserLoopV2Commands } from "../src/v2/user-commands.js";

const NOW = 10_000;

describe("Loop 2.0 scopes and registrations", () => {
	it("keeps AI actions session-only while explicit user commands define and register shared work", () => {
		const roots = createRoots();
		const journal = createJournal();
		const core = createCore("session-a", journal.port, roots);
		const ai = new AiSessionActions(core);
		const user = new UserLoopV2Commands(core);

		const denied = ai.execute({ action: "add", scope: "global", prompt: "escalate", schedule: { kind: "once", runAt: NOW } });
		assert.equal(denied.ok, false);
		assert.match(denied.message, /do not accept scope/);
		assert.deepEqual(core.listAvailable(), []);

		const local = ai.execute({ action: "add", prompt: "session work", schedule: { kind: "once", runAt: NOW } });
		assert.equal(local.ok, true);
		assert.equal(local.active[0]?.kind, "session");

		const workspace = user.defineSharedTask("workspace", { prompt: "workspace work", schedule: { kind: "interval", intervalMs: 500 } });
		const global = user.defineSharedTask("global", { prompt: "global work", schedule: { kind: "once", runAt: NOW } });
		const available = user.listAvailable();
		assert.deepEqual(available.map((definition) => definition.id).sort(), [global.id, workspace.id].sort());
		assert.equal(core.snapshotSessionState().registrations.length, 0);
		assert.equal(core.listActive().filter((item) => item.kind === "registration").length, 0);

		const registration = user.registerSharedTask("workspace", workspace.id);
		const stateAfterRegistration = core.snapshotSessionState();
		assert.equal(stateAfterRegistration.tasks.length, 1);
		assert.equal(Object.hasOwn(stateAfterRegistration.registrations[0] ?? {}, "prompt"), false);
		assert.equal(Object.hasOwn(stateAfterRegistration.registrations[0] ?? {}, "schedule"), false);
		assert.equal(core.listActive().some((item) => item.kind === "registration" && item.registration.id === registration.id), true);
		assert.deepEqual(user.listAvailable().map((definition) => definition.id), [global.id]);
		assert.equal(existsSync(join(roots.workspace, ".pi", "scheduled-wakeup", "v2", "workspace-definitions.json")), true);
		assert.equal(existsSync(join(roots.global, ".pi", "scheduled-wakeup", "v2", "global-definitions.json")), true);
	});

	it("rejects a shared document containing a definition for another scope", () => {
		const roots = createRoots();
		const documentPath = join(roots.workspace, ".pi", "scheduled-wakeup", "v2", "workspace-definitions.json");
		mkdirSync(join(roots.workspace, ".pi", "scheduled-wakeup", "v2"), { recursive: true });
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

		const definitions = new SharedDefinitionStore(roots.workspace, roots.global);
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
		const registration = core.registerSharedDefinition("workspace", definition.id);
		const documentPath = join(roots.workspace, ".pi", "scheduled-wakeup", "v2", "workspace-definitions.json");
		assert.match(readFileSync(documentPath, "utf8"), /workspace work/);
		writeFileSync(documentPath, "{", "utf8");

		const active = core.listActive();
		assert.equal(active.length, 1);
		assert.equal(
			active.some(
				(item) =>
					item.kind === "registration" && item.registration.id === registration.id && item.definition === undefined,
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
		const definition = owner.defineSharedTask("global", { prompt: "shared", schedule: { kind: "once", runAt: NOW } });
		const firstRegistration = owner.registerSharedTask("global", definition.id);

		const secondJournal = createJournal();
		const second = createCore("session-two", secondJournal.port, roots);
		const secondCommands = new UserLoopV2Commands(second);
		assert.deepEqual(secondCommands.listAvailable(["global"]).map((candidate) => candidate.id), [definition.id]);
		const secondRegistration = secondCommands.registerSharedTask("global", definition.id);

		assert.notEqual(firstRegistration.id, "");
		assert.notEqual(secondRegistration.id, "");
		assert.equal(first.executeRegistration(firstRegistration.id, () => undefined).kind, "executed");
		assert.equal(first.snapshotSessionState().registrations[0]?.progress.runCount, 1);
		assert.equal(second.snapshotSessionState().registrations[0]?.progress.runCount, 0);
		assert.equal(second.executeRegistration(secondRegistration.id, () => undefined).kind, "executed");
		assert.equal(second.snapshotSessionState().registrations[0]?.progress.runCount, 1);
	});
});

type Roots = { workspace: string; global: string };

function createRoots(): Roots {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-v2-"));
	return { workspace: join(root, "workspace"), global: join(root, "global") };
}

function createCore(sessionId: string, sessionEntries: SessionEntryPort, roots: Roots): LoopV2Core {
	return new LoopV2Core({ sessionId, sessionEntries, workspaceRoot: roots.workspace, globalRoot: roots.global, now: () => NOW });
}

function createJournal(): { entries: SessionEntryLike[]; port: SessionEntryPort } {
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
