import assert from "node:assert/strict";
import test from "node:test";
import register from "../src/extension.js";
import type { FooterFactory } from "../src/footer-component.js";
import type { PiEventHandler, PiEventName, PiExtensionAPI, PiExtensionContext } from "../src/pi-extension-contract.js";
import { makeModel } from "./test-model.js";

test("uses the host's current thinking level at startup and after model and turn events", () => {
	const handlers = new Map<PiEventName, PiEventHandler>();
	const factories: FooterFactory[] = [];
	const pi: PiExtensionAPI = {
		on: (name, handler) => { handlers.set(name, handler); },
		registerCommand: () => {},
	};
	register(pi);
	const model = makeModel({ provider: "unsupported", baseUrl: "https://example.invalid", reasoning: true });
	const context: PiExtensionContext = {
		mode: "tui",
		model,
		thinkingLevel: "high",
		sessionManager: {
			getSessionId: () => "session-1", getEntries: () => [],
			getCwd: () => "/tmp", getSessionName: () => undefined,
		},
		modelRegistry: {
			getAll: () => [], getAvailable: () => [], getProvider: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }), isUsingOAuth: () => false,
		},
		ui: {
			setFooter: (factory) => { if (factory) factories.push(factory); },
			notify: () => {}, addAutocompleteProvider: () => {},
		},
		getContextUsage: () => undefined,
	};
	const start = handlers.get("session_start");
	if (!start) throw new Error("missing session_start");
	start({}, context);
	const factory = factories[0];
	if (!factory) throw new Error("footer was not installed");
	const footer = factory(
		{ requestRender: () => {} },
		{ fg: (_color, text) => text, bold: (text) => text },
		{
			getGitBranch: () => null, getExtensionStatuses: () => new Map(),
			getAvailableProviderCount: () => 1, onBranchChange: () => () => {},
		},
	);
	assert.match(footer.render(100)[1] ?? "", /test-model • high$/);
	const turn = handlers.get("turn_end");
	if (!turn) throw new Error("missing turn_end");
	turn({}, context);
	assert.match(footer.render(100)[1] ?? "", /test-model • high$/);
	context.thinkingLevel = "xhigh";
	const select = handlers.get("model_select");
	if (!select) throw new Error("missing model_select");
	select({ model }, context);
	assert.match(footer.render(100)[1] ?? "", /test-model • xhigh$/);
	context.thinkingLevel = "off";
	turn({}, context);
	assert.match(footer.render(100)[1] ?? "", /test-model • thinking off$/);
	handlers.get("session_shutdown")?.({}, context);
});
