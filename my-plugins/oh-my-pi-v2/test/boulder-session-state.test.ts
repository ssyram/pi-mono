import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBoulderSessionStateStore } from "../hooks/boulder-session-state.js";

function context(identity: object): ExtensionContext {
	return { sessionManager: identity } as unknown as ExtensionContext;
}

it("isolates retry state and active waits by session manager identity", () => {
	const store = createBoulderSessionStateStore();
	const first = context({});
	const second = context({});
	let cancellations = 0;
	const firstState = store.get(first);
	firstState.episode = { key: "first", attemptsSent: 2 };
	firstState.activeWait = {
		episodeKey: "first",
		externalInputEpoch: 0,
		attempt: 3,
		handle: { cancel: () => cancellations += 1 },
	};

	assert.equal(store.get(second).episode, undefined);
	store.markExternalInformation(first);
	assert.equal(cancellations, 1);
	assert.equal(store.get(first).externalInputEpoch, 1);
	assert.equal(store.get(first).episode, undefined);
	assert.equal(store.get(second).externalInputEpoch, 0);
});
