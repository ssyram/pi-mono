import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import skillRefExtension from "../index.js";
import { formatPrintedResources } from "./printed-resources.js";
import type { CommandLike } from "./registry.js";

const CONTENT_ALPHA = "---\nname: alpha\n---\nALPHA BODY $ARGUMENTS\n";
const CONTENT_BRAVO = "BRAVO TEMPLATE\n";

interface Captured {
	handlers: Record<string, (...args: never[]) => unknown>;
	tools: string[];
	provider?: AutocompleteProvider;
}

function loadExtension(commands: CommandLike[]): Captured {
	const captured: Captured = { handlers: {}, tools: [] };
	const pi = {
		getCommands: () => commands,
		on: (event: string, handler: (...args: never[]) => unknown) => {
			captured.handlers[event] = handler;
		},
		registerTool: (tool: { name: string }) => {
			captured.tools.push(tool.name);
		},
	} as unknown as ExtensionAPI;
	skillRefExtension(pi);
	return captured;
}

function registerProvider(captured: Captured): void {
	(captured.handlers.session_start as (event: undefined, ctx: unknown) => void)(undefined, {
		ui: {
			addAutocompleteProvider: (factory: (current: AutocompleteProvider) => AutocompleteProvider) => {
				const base: AutocompleteProvider = {
					async getSuggestions() {
						return null;
					},
					applyCompletion(lines, cursorLine, cursorCol) {
						return { lines, cursorLine, cursorCol };
					},
				};
				captured.provider = factory(base);
			},
		},
	});
}

const sendInput = (captured: Captured, text: string): unknown =>
	(captured.handlers.input as (event: { text: string }) => unknown)({ text });

describe("skill-ref integration", () => {
	let directory!: string;
	let captured!: Captured;

	before(() => {
		const parent = resolve("my-plugins", "skill-ref", ".pi");
		mkdirSync(parent, { recursive: true });
		directory = mkdtempSync(join(parent, "integration-"));
		writeFileSync(join(directory, "alpha.md"), CONTENT_ALPHA);
		writeFileSync(join(directory, "bravo.md"), CONTENT_BRAVO);
		const commands: CommandLike[] = [
			{
				name: "skill:alpha",
				description: "alpha skill",
				source: "skill",
				sourceInfo: { path: join(directory, "alpha.md"), baseDir: directory },
			},
			{
				name: "bravo",
				description: "bravo prompt",
				source: "prompt",
				sourceInfo: { path: join(directory, "bravo.md") },
			},
		];
		captured = loadExtension(commands);
		registerProvider(captured);
	});

	after(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("registers the tool and both event handlers at load time", () => {
		assert.deepEqual(captured.tools, ["try_load_skill_or_prompt"]);
		assert.ok(captured.handlers.input);
		assert.ok(captured.handlers.session_start);
	});

	it("cashes print modifiers in at send time through the real registry chain", () => {
		const result = sendInput(captured, "use /alpha :print ok") as { action: string; text: string };
		assert.equal(result.action, "transform");
		assert.equal(result.text, `use /alpha ok${formatPrintedResources([CONTENT_ALPHA])}`);
	});

	it("replaces path modifiers with absolute file paths", () => {
		const result = sendInput(captured, "see /bravo::path and /alpha:path") as { action: string; text: string };
		assert.equal(result.text, `see ${join(directory, "bravo.md")} and ${join(directory, "alpha.md")}`);
	});

	it("replaces a bare escaped separator at send time", () => {
		const result = sendInput(captured, "use /alpha \\: ok") as { action: string; text: string };
		assert.equal(result.action, "transform");
		assert.equal(result.text, "use /alpha : ok");
	});

	it("leaves the first meaningful line and modifier-free text to pi", () => {
		assert.equal(sendInput(captured, "/alpha :print"), undefined);
		assert.equal(sendInput(captured, "plain question"), undefined);
		assert.equal(sendInput(captured, "use /ghost :print"), undefined);
	});

	it("unescapes literal modifiers at send time without loading", () => {
		const result = sendInput(captured, "use /alpha \\:print") as { action: string; text: string };
		assert.equal(result.text, "use /alpha :print");
	});

	it("composes the modifier provider around the name provider", async () => {
		assert.ok(captured.provider?.triggerCharacters?.includes(":"));
		const menu = await captured.provider?.getSuggestions(["use /alpha :"], 0, 12, {
			signal: new AbortController().signal,
			force: false,
		});
		assert.deepEqual(
			menu?.items.map((item) => item.value),
			[":print", ":path", "\\:"],
		);
		const names = await captured.provider?.getSuggestions(["use /al"], 0, 7, {
			signal: new AbortController().signal,
			force: true,
		});
		assert.deepEqual(
			names?.items.map((item) => item.value),
			["/alpha"],
		);
	});

	it("re-registers the provider on every session_start", () => {
		captured.provider = undefined;
		registerProvider(captured);
		assert.ok(captured.provider);
	});
});
