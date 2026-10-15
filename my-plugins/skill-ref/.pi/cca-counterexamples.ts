import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { normalizeAutocompleteSuggestions } from "../src/autocomplete-result.js";
import { loadExactReference } from "../src/exact-resource.js";
import { createModifierProvider } from "../src/modifier-autocomplete.js";
import { extractModifierContext } from "../src/modifier-context.js";
import type { SkillRefEntry } from "../src/registry.js";
import { listEntries } from "../src/registry.js";
import { transformReferences } from "../src/transform-references.js";

const makeEntry = (name = "a"): SkillRefEntry => ({ kind: "skill", name, qualifiedName: `skill:${name}`, description: "", path: "/s/a/SKILL.md" });
const delegate: AutocompleteProvider = {
	async getSuggestions() { return null; },
	applyCompletion(lines, cursorLine, cursorCol) { return { lines, cursorLine, cursorCol }; },
	shouldTriggerFileCompletion() { return false; },
};

if (process.argv[2] === "rejection-child") {
	const broken = { ...delegate, applyCompletion() { return Promise.reject(new Error("downstream-edit-rejection")); } } as unknown as AutocompleteProvider;
	const provider = createModifierProvider(broken, () => [], () => "body");
	const fallback = provider.applyCompletion(["ordinary"], 0, 8, { value: "x", label: "x" }, "x");
	console.log(JSON.stringify({ returnedFallback: fallback.lines[0] === "ordinary" }));
	await setImmediate();
} else {
	const findings: Record<string, unknown> = {};
	const items = [{ value: ":print", label: ":print" }];
	Object.defineProperty(items, Symbol.iterator, { value: function* () {} });
	const suggestions = normalizeAutocompleteSuggestions({ prefix: ":", items });
	assert.ok(suggestions);
	assert.equal(suggestions.items.length, 0);
	findings.emptyIterator = { inputArrayLength: items.length, outputItemsLength: suggestions.items.length };

	const loaded = loadExactReference([makeEntry()], "/a", (entry) => { entry.path = "relative.md"; return "body"; });
	assert.equal(loaded?.entry.path, "relative.md");
	findings.readerMutationPath = loaded?.entry.path;
	let escapedError = "";
	try {
		transformReferences("/a:path", [makeEntry()], (entry) => {
			Object.defineProperty(entry, "path", { get(): string { throw new Error("mutated-path-read"); } });
			return "body";
		});
	} catch (error) {
		escapedError = error instanceof Error ? error.message : "unexpected";
	}
	assert.equal(escapedError, "mutated-path-read");
	findings.transformException = escapedError;

	let reads = 0;
	const item = { label: "print", get value(): string { reads++; return reads < 3 ? ":print" : ":" + "x".repeat(1000); } };
	const provider = createModifierProvider(delegate, () => [makeEntry()], () => "body");
	const edit = provider.applyCompletion(["/a :"], 0, 4, item, ":");
	assert.ok(edit.cursorCol > edit.lines[0]!.length);
	findings.unstableTypedItem = { reads, cursorCol: edit.cursorCol, lineLength: edit.lines[0]!.length };

	let registryError = "";
	try {
		listEntries(() => [{ name: "a", get source(): string { throw new Error("command-source-getter"); } }]);
	} catch (error) {
		registryError = error instanceof Error ? error.message : "unexpected";
	}
	assert.equal(registryError, "command-source-getter");
	findings.registryException = registryError;

	const escapedPrefix = "/skill\\:pr";
	assert.equal(extractModifierContext([escapedPrefix], 0, escapedPrefix.length), null);
	assert.equal(transformReferences("/skill\\:print", [], () => "body"), "/skill:print");
	findings.escapedKindPrefix = { context: null, sentLiteral: "/skill:print" };

	const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", fileURLToPath(import.meta.url), "rejection-child"], { encoding: "utf8" });
	assert.equal(child.status, 1);
	assert.ok(child.stdout.includes('"returnedFallback":true'));
	assert.ok(child.stderr.includes("downstream-edit-rejection"));
	findings.invalidAsyncDelegate = { processExitCode: child.status, returnedFallback: true, unhandledRejection: true };
	console.log(JSON.stringify(findings, null, 2));
}
