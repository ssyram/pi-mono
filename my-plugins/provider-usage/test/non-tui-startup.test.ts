import assert from "node:assert/strict";
import test from "node:test";
import register from "../src/extension.js";
import type { PiEventHandler, PiEventName, PiExtensionAPI, PiExtensionContext } from "../src/pi-extension-contract.js";
import { makeModel } from "./test-model.js";

test("does not install a footer or resolve authentication outside TUI mode", () => {
	const handlers = new Map<PiEventName, PiEventHandler>();
	const pi: PiExtensionAPI = {
		on: (event, handler) => { handlers.set(event, handler); },
		registerCommand: () => {},
	};
	register(pi);
	assert.equal(handlers.has("turn_end"), true);
	assert.doesNotMatch([...handlers.keys()].join(","), /agent_end/);
	const model = makeModel();
	let footerCalls = 0;
	let authCalls = 0;
	const context: PiExtensionContext = {
		mode: "print",
		model,
		sessionManager: {
			getSessionId: () => "session-1",
			getEntries: () => [],
			getCwd: () => "/tmp/project",
			getSessionName: () => undefined,
		},
		modelRegistry: {
			getProvider: () => undefined,
			getAll: () => [],
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => {
				authCalls += 1;
				return { ok: false };
			},
			isUsingOAuth: () => false,
		},
		ui: {
			setFooter: () => { footerCalls += 1; },
			notify: () => {},
			addAutocompleteProvider: () => {},
		},
		getContextUsage: () => undefined,
	};
	const start = handlers.get("session_start");
	if (!start) throw new Error("session_start should be registered");
	start({}, context);
	assert.equal(footerCalls, 0);
	assert.equal(authCalls, 0);
});
