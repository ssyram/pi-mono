import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { SharedDefinitionStore } from "../src/v2/definition-store.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";
import { UserLoopV2Commands } from "../src/v2/user-commands.js";

const NOW = 20_000;

describe("Loop 2.0 shared registration index and deletion", () => {
	it("indexes two sessions independently and blocks ordinary deletion while another session remains", () => {
		const roots = createRoots();
		const first = createCore("first", createJournal().port, roots);
		const definition = first.createSharedDefinition("global", { prompt: "shared", schedule: { kind: "once", runAt: NOW } });
		const firstRegistration = first.registerSharedDefinition("global", definition.id);
		const second = createCore("second", createJournal().port, roots);
		const secondRegistration = second.registerSharedDefinition("global", definition.id);
		const catalog = new SharedDefinitionStore(roots.workspace, roots.global);
		assert.deepEqual(catalog.listRegistrationIndex("global").map((entry) => entry.sessionId).sort(), ["first", "second"]);
		assert.deepEqual(first.deleteSharedDefinition("global", definition.id), { kind: "registered-by-others" });
		assert.equal(first.executeRegistration(firstRegistration.id, () => undefined).kind, "executed");
		assert.equal(second.executeRegistration(secondRegistration.id, () => undefined).kind, "executed");
	});

	it("lets AI cancel only its registration, rejects force, and applies ordinary deletion rules", () => {
		const roots = createRoots();
		const first = createCore("first", createJournal().port, roots);
		const definition = first.createSharedDefinition("workspace", { prompt: "shared", schedule: { kind: "once", runAt: NOW } });
		const registration = first.registerSharedDefinition("workspace", definition.id);
		const second = createCore("second", createJournal().port, roots);
		second.registerSharedDefinition("workspace", definition.id);
		const ai = new AiSessionActions(first);
		assert.equal(ai.execute({ action: "delete", id: registration.id }).ok, false);
		assert.match(ai.execute({ action: "delete", id: registration.id }).message, /registered-by-others/);
		assert.equal(ai.execute({ action: "delete", id: registration.id, force: true }).ok, false);
		assert.match(ai.execute({ action: "delete", id: registration.id, force: true }).message, /scope or force/);
		assert.equal(ai.execute({ action: "cancel", id: registration.id }).ok, true);
		assert.equal(first.snapshotSessionState().registrations.length, 0);
		assert.equal(second.snapshotSessionState().registrations.length, 1);
	});

	it("force delete invalidates remote old references and reconciliation removes them later", () => {
		const roots = createRoots();
		const first = createCore("first", createJournal().port, roots);
		const definition = first.createSharedDefinition("global", { prompt: "shared", schedule: { kind: "once", runAt: NOW } });
		const firstRegistration = first.registerSharedDefinition("global", definition.id);
		const secondJournal = createJournal();
		const second = createCore("second", secondJournal.port, roots);
		const secondRegistration = second.registerSharedDefinition("global", definition.id);
		assert.deepEqual(new UserLoopV2Commands(first).deleteSharedTask("global", definition.id, true), { kind: "deleted" });
		assert.equal(first.snapshotSessionState().registrations.length, 0);
		assert.equal(second.executeRegistration(secondRegistration.id, () => undefined).kind, "unavailable");
		assert.deepEqual(second.reconcileSharedRegistrations(), [secondRegistration.id]);
		assert.equal(second.snapshotSessionState().registrations.length, 0);
		assert.equal(first.executeRegistration(firstRegistration.id, () => undefined).kind, "missing");
	});

	it("keeps an index after a failed first session append and removes it only after session removal persists", () => {
		const roots = createRoots();
		const definitionOwner = createCore("owner", createJournal().port, roots);
		const definition = definitionOwner.createSharedDefinition("workspace", { prompt: "shared", schedule: { kind: "once", runAt: NOW } });
		const failing: SessionEntryPort = { getBranch: () => [], appendEntry: () => { throw new Error("append failed"); } };
		const failed = createCore("retry", failing, roots);
		assert.throws(() => failed.registerSharedDefinition("workspace", definition.id), /append failed/);
		const catalog = new SharedDefinitionStore(roots.workspace, roots.global);
		assert.equal(catalog.listRegistrationIndex("workspace").length, 1);
		const journal = createJournal();
		const retry = createCore("retry", journal.port, roots);
		const registration = retry.registerSharedDefinition("workspace", definition.id);
		assert.equal(retry.registerSharedDefinition("workspace", definition.id).id, registration.id);
		let indexPresentDuringRemoval = false;
		journal.onAppend = () => { indexPresentDuringRemoval = catalog.listRegistrationIndex("workspace").length === 1; };
		assert.equal(retry.unregisterSharedDefinition(registration.id), "cancelled");
		assert.equal(indexPresentDuringRemoval, true);
		assert.equal(catalog.listRegistrationIndex("workspace").length, 0);
	});
});

type Roots = { workspace: string; global: string };
type Journal = { entries: SessionEntryLike[]; port: SessionEntryPort; onAppend?: () => void };
function createRoots(): Roots { const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-v2-")); return { workspace: join(root, "workspace"), global: join(root, "global") }; }
function createCore(sessionId: string, port: SessionEntryPort, roots: Roots): LoopV2Core { return new LoopV2Core({ sessionId, sessionEntries: port, workspaceRoot: roots.workspace, globalRoot: roots.global, now: () => NOW }); }
function createJournal(): Journal {
	const journal: Journal = { entries: [], port: undefined as unknown as SessionEntryPort };
	journal.port = { getBranch: () => journal.entries, appendEntry: (customType, data) => { journal.onAppend?.(); journal.entries.push({ type: "custom", customType, data }); } };
	return journal;
}
