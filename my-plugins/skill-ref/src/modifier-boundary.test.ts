import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import type { AutocompleteEdit } from "./autocomplete-result.js";
import { createModifierProvider } from "./modifier-autocomplete.js";
import { createModifierTestDelegate, MODIFIER_TEST_ENTRIES } from "./modifier-fixtures.js";

const options = { signal: new AbortController().signal, force: false };
const getEntries = () => MODIFIER_TEST_ENTRIES;
const read = () => "body";
const line = "use /alpha :";
const item = { value: ":print", label: "print" };

describe("pi modifier callback safety", () => {
	it("contains getEntries exceptions in every callback", async () => {
		const provider = createModifierProvider(
			createModifierTestDelegate(),
			() => {
				throw new Error("registry");
			},
			read,
		);
		assert.equal(await provider.getSuggestions([line], 0, line.length, options), null);
		assert.deepEqual(provider.applyCompletion([line], 0, line.length, item, ":"), {
			lines: [line],
			cursorLine: 0,
			cursorCol: line.length,
		});
		assert.equal(provider.shouldTriggerFileCompletion?.([line], 0, line.length), false);
	});

	it("contains reader failure without exposing modifier commands", async () => {
		const provider = createModifierProvider(createModifierTestDelegate(), getEntries, () => {
			throw new Error("read");
		});
		assert.equal(await provider.getSuggestions([line], 0, line.length, options), null);
		assert.deepEqual(provider.applyCompletion([line], 0, line.length, item, ":"), {
			lines: [line],
			cursorLine: 0,
			cursorCol: line.length,
		});
		assert.equal(provider.shouldTriggerFileCompletion?.([line], 0, line.length), false);
	});

	it("contains downstream synchronous throws and asynchronous rejections", async () => {
		for (const asynchronous of [false, true]) {
			const current = createModifierTestDelegate();
			current.getSuggestions = () => {
				if (asynchronous) return Promise.reject(new Error("async"));
				throw new Error("sync");
			};
			const provider = createModifierProvider(current, getEntries, read);
			assert.equal(await provider.getSuggestions(["ordinary"], 0, 8, options), null);
		}
	});

	it("normalizes undefined or malformed downstream suggestions", async () => {
		for (const value of [
			undefined,
			{},
			{ prefix: ":", items: [{ value: "x" }] },
			{
				get items() {
					throw new Error("getter");
				},
			},
		]) {
			const current = createModifierTestDelegate();
			current.getSuggestions = async () => value as AutocompleteSuggestions;
			const provider = createModifierProvider(current, getEntries, read);
			assert.equal(await provider.getSuggestions(["ordinary"], 0, 8, options), null);
		}
	});

	it("returns a pristine edit snapshot after downstream mutation and failure", () => {
		const current = createModifierTestDelegate();
		current.applyCompletion = (lines) => {
			lines[0] = "mutated";
			throw new Error("apply");
		};
		const provider = createModifierProvider(current, getEntries, read);
		const lines = ["ordinary"];
		assert.deepEqual(provider.applyCompletion(lines, 0, 8, item, ":"), {
			lines: ["ordinary"],
			cursorLine: 0,
			cursorCol: 8,
		});
		assert.deepEqual(lines, ["ordinary"]);
	});

	it("rejects downstream undefined, empty lines and invalid cursor locations", () => {
		for (const value of [
			undefined,
			{},
			{ lines: [], cursorLine: 0, cursorCol: 0 },
			{ lines: ["x"], cursorLine: 1, cursorCol: 0 },
			{ lines: ["x"], cursorLine: 0, cursorCol: 2 },
		]) {
			const current = createModifierTestDelegate();
			current.applyCompletion = () => value as AutocompleteEdit;
			const provider = createModifierProvider(current, getEntries, read);
			assert.deepEqual(provider.applyCompletion(["ordinary"], 0, 8, item, ":"), {
				lines: ["ordinary"],
				cursorLine: 0,
				cursorCol: 8,
			});
		}
	});

	it("returns only booleans after gate throws, invalid values or absent callbacks", () => {
		for (const value of [undefined, "yes", null, true, false]) {
			const current = createModifierTestDelegate();
			current.shouldTriggerFileCompletion = () => value as boolean;
			const provider = createModifierProvider(current, getEntries, read);
			assert.equal(provider.shouldTriggerFileCompletion?.(["ordinary"], 0, 8), value === true);
		}
		const current = createModifierTestDelegate();
		delete current.shouldTriggerFileCompletion;
		assert.equal(
			createModifierProvider(current, getEntries, read).shouldTriggerFileCompletion?.(["ordinary"], 0, 8),
			true,
		);
		Object.defineProperty(current, "shouldTriggerFileCompletion", { value: "invalid", writable: true });
		assert.equal(
			createModifierProvider(current, getEntries, read).shouldTriggerFileCompletion?.(["ordinary"], 0, 8),
			false,
		);
		current.shouldTriggerFileCompletion = () => {
			throw new Error("gate");
		};
		assert.equal(
			createModifierProvider(current, getEntries, read).shouldTriggerFileCompletion?.(["ordinary"], 0, 8),
			false,
		);
	});

	it("filters invalid trigger strings and deduplicates the colon", () => {
		const current = createModifierTestDelegate();
		current.triggerCharacters = ["#", "#", "not-a-character", ":"];
		assert.deepEqual(createModifierProvider(current, getEntries, read).triggerCharacters, ["#", ":"]);
	});

	it("contains throwing callback getters and trigger-list getters", async () => {
		const current = createModifierTestDelegate();
		Object.defineProperty(current, "triggerCharacters", {
			get() {
				throw new Error("triggers");
			},
		});
		Object.defineProperty(current, "getSuggestions", {
			get() {
				throw new Error("suggestions getter");
			},
		});
		Object.defineProperty(current, "applyCompletion", {
			get() {
				throw new Error("edit getter");
			},
		});
		Object.defineProperty(current, "shouldTriggerFileCompletion", {
			get() {
				throw new Error("gate getter");
			},
		});
		const provider: AutocompleteProvider = createModifierProvider(current, getEntries, read);
		assert.deepEqual(provider.triggerCharacters, [":"]);
		assert.equal(await provider.getSuggestions(["ordinary"], 0, 8, options), null);
		assert.deepEqual(provider.applyCompletion(["ordinary"], 0, 8, item, ":"), {
			lines: ["ordinary"],
			cursorLine: 0,
			cursorCol: 8,
		});
		assert.equal(provider.shouldTriggerFileCompletion?.(["ordinary"], 0, 8), false);
	});

	it("swallows a rejection when the delegate wrongly returns a promise", async () => {
		let rejections = 0;
		const listener = (): void => {
			rejections += 1;
		};
		process.on("unhandledRejection", listener);
		try {
			const current = createModifierTestDelegate();
			current.applyCompletion = (() =>
				Promise.reject(new Error("wrongly async"))) as unknown as typeof current.applyCompletion;
			const provider = createModifierProvider(current, getEntries, read);
			assert.deepEqual(provider.applyCompletion(["ordinary"], 0, 8, item, ":"), {
				lines: ["ordinary"],
				cursorLine: 0,
				cursorCol: 8,
			});
			await setTimeout(20);
			assert.equal(rejections, 0);
		} finally {
			process.off("unhandledRejection", listener);
		}
	});

	it("swallows a rejection when the gate wrongly returns a promise", async () => {
		let rejections = 0;
		const listener = (): void => {
			rejections += 1;
		};
		process.on("unhandledRejection", listener);
		try {
			const current = createModifierTestDelegate();
			current.shouldTriggerFileCompletion = (() =>
				Promise.reject(new Error("gate async"))) as unknown as typeof current.shouldTriggerFileCompletion;
			const provider = createModifierProvider(current, getEntries, read);
			assert.equal(provider.shouldTriggerFileCompletion?.(["ordinary"], 0, 8), false);
			await setTimeout(20);
			assert.equal(rejections, 0);
		} finally {
			process.off("unhandledRejection", listener);
		}
	});
});
