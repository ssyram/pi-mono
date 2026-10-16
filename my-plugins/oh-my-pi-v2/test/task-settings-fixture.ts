import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import type {
	SettingsEntry,
	SettingsSession,
} from "../../my-settings/protocol.ts";
import { registerMySettingsService } from "../../my-settings/settings-service.ts";
import { createTaskSettings } from "../task-settings.js";

export async function taskSettingsFixture(t: TestContext) {
	const root = await mkdtemp("/tmp/task-settings-");
	t.after(() => rm(root, { recursive: true, force: true }));
	const globalRoot = join(root, "agent"),
		cwd = join(root, "project");
	await mkdir(globalRoot);
	await mkdir(join(cwd, ".pi"), { recursive: true });
	const bus = createEventBus();
	let sessionId = "session-a";
	let entries: SettingsEntry[] = [];
	let failAppend = false;
	const manager = { getSessionId: () => sessionId };
	const context = {
		cwd,
		sessionManager: manager,
	} as unknown as ExtensionContext;
	const current: SettingsSession = {
		cwd,
		isCurrent: () => ({ ok: true, value: true }),
		getBranch: () => ({ ok: true, value: entries }),
		appendEntry(customType, data) {
			if (failAppend)
				return {
					ok: false,
					error: { code: "OPERATION_FAILED", message: "append unavailable" },
				};
			entries.push({ type: "custom", customType, data: structuredClone(data) });
			return { ok: true, value: undefined };
		},
	};
	const registration = registerMySettingsService(
		bus,
		(identity, id) => ({
			ok: true,
			value: identity === manager && id === sessionId ? current : undefined,
		}),
		globalRoot,
		withFileMutationQueue,
	);
	assert.ok(registration.ok);
	t.after(() => {
		registration.value();
	});
	const pi = { events: bus };
	return {
		cwd,
		globalRoot,
		context,
		pi,
		bus,
		settings: createTaskSettings(pi),
		branch: () => entries,
		setBranch(value: SettingsEntry[]) {
			entries = value;
		},
		replaceSession() {
			sessionId = "session-b";
			entries = [];
		},
		failAppend(value: boolean) {
			failAppend = value;
		},
		dispose() {
			registration.value();
		},
	};
}
