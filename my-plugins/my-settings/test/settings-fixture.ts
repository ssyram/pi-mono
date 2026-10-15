import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { createMySettingsClient } from "../client.ts";
import type { SettingsEntry, SettingsLog, SettingsSession } from "../protocol.ts";
import { registerMySettingsService } from "../settings-service.ts";

export async function settingsFixture(t: TestContext) {
	const root = await mkdtemp(join("/tmp", "my-settings-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const globalRoot = join(root, "agent");
	const cwd = join(root, "project");
	await mkdir(globalRoot);
	await mkdir(cwd);
	const bus = createEventBus();
	const owner = { session: {}, sessionId: "session-1" };
	let entries: SettingsEntry[] = [];
	let active = true;
	let appendFailure = false;
	const session: SettingsSession = {
		cwd,
		isCurrent: () => ({ ok: true, value: active }),
		getBranch: () => ({ ok: true, value: entries }),
		appendEntry(customType: string, data: SettingsLog) {
			if (appendFailure) throw new Error("session log unavailable");
			entries.push({ type: "custom", customType, data: structuredClone(data) });
			return { ok: true, value: undefined };
		},
	};
	const dispose = registerMySettingsService(
		bus,
		(identity, id) => ({
			ok: true,
			value: identity === owner.session && id === owner.sessionId ? session : undefined,
		}),
		globalRoot,
		withFileMutationQueue,
	);
	assert.ok(dispose.ok);
	t.after(() => {
		assert.ok(dispose.value().ok);
	});
	return {
		globalRoot,
		cwd,
		bus,
		owner,
		session,
		client: createMySettingsClient(bus, owner),
		branch: () => entries,
		setBranch(branch: SettingsEntry[]) {
			entries = branch;
		},
		setActive(value: boolean) {
			active = value;
		},
		failAppend() {
			appendFailure = true;
		},
	};
}
