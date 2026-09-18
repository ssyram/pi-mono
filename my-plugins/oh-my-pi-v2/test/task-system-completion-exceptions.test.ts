import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Editor } from "@earendil-works/pi-tui";
import type { TaskAutocompleteProvider } from "../commands/task-completion.js";
import { createHumanTaskCompletionProvider } from "../tools/task-system/human-completion.js";

const options = { signal: new AbortController().signal, force: true };
const item = { value: "fallback", label: "fallback" };
const poison = {
	toString() {
		throw new Error("must not stringify");
	},
};
function delegate(): TaskAutocompleteProvider {
	return {
		async getSuggestions() {
			return { prefix: "", items: [item] };
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
		shouldTriggerFileCompletion() {
			return true;
		},
	};
}

describe("autocomplete exception containment", () => {
	it("contains synchronous delegate throws and async rejections, protecting input from mutation", async () => {
		for (const asynchronous of [false, true]) {
			const current = delegate();
			let calls = 0;
			current.getSuggestions = (lines, _row, _col, received) => {
				assert.equal(received, options);
				calls++;
				lines[0] = "corrupted";
				if (asynchronous) return Promise.reject(poison);
				throw poison;
			};
			const provider = createHumanTaskCompletionProvider(current, () =>
				assert.fail(),
			);
			const lines = ["outside", "suffix"];
			assert.equal(await provider.getSuggestions(lines, 0, 7, options), null);
			assert.deepEqual(lines, ["outside", "suffix"]);
			assert.equal(calls, 1);
		}
	});
	it("contains mutation-then-throw application and trigger with independent unchanged input", () => {
		const current = delegate();
		let applications = 0;
		let triggers = 0;
		current.applyCompletion = (lines) => {
			applications++;
			lines.splice(0, 2, "bad");
			throw poison;
		};
		current.shouldTriggerFileCompletion = (lines) => {
			triggers++;
			lines[0] = "bad";
			throw poison;
		};
		const provider = createHumanTaskCompletionProvider(current, () =>
			assert.fail(),
		);
		const lines = ["outside", "suffix"];
		assert.deepEqual(provider.applyCompletion(lines, 0, 4, item, ""), {
			lines: ["outside", "suffix"],
			cursorLine: 0,
			cursorCol: 4,
		});
		assert.equal(provider.shouldTriggerFileCompletion(lines, 0, 4), false);
		assert.deepEqual(lines, ["outside", "suffix"]);
		assert.equal(applications, 1);
		assert.equal(triggers, 1);
	});
	it("contains owned reader faults without delegating, resetting state or retrying", async () => {
		const current = delegate();
		current.getSuggestions = () => assert.fail("must not delegate");
		current.applyCompletion = () => assert.fail("must not delegate");
		let reads = 0;
		const provider = createHumanTaskCompletionProvider(current, () => {
			reads++;
			throw poison;
		});
		const lines = ["/task modify "];
		const cursorCol = lines[0].length;
		assert.equal(
			await provider.getSuggestions(lines, 0, cursorCol, options),
			null,
		);
		assert.deepEqual(
			provider.applyCompletion(
				lines,
				0,
				cursorCol,
				{ value: "1", label: "1" },
				"",
			),
			{
				lines: ["/task modify "],
				cursorLine: 0,
				cursorCol,
			},
		);
		assert.equal(reads, 2);
		assert.deepEqual(lines, ["/task modify "]);
	});
	it("contains selection property failure without attempting the delegate", () => {
		const current = delegate();
		current.applyCompletion = () => assert.fail();
		const provider = createHumanTaskCompletionProvider(current, () => []);
		const broken = Object.defineProperty(
			{ value: "open", label: "open" },
			"value",
			{
				get() {
					throw poison;
				},
			},
		);
		const lines = ["/task list --type op"];
		assert.deepEqual(
			provider.applyCompletion(lines, 0, lines[0].length, broken, "op"),
			{
				lines: [...lines],
				cursorLine: 0,
				cursorCol: lines[0].length,
			},
		);
	});
	it("keeps the actual built editor request chain usable after a delegate rejection", async () => {
		const current = delegate();
		let calls = 0;
		current.getSuggestions = async () => {
			calls++;
			if (calls === 1) throw poison;
			return { prefix: "", items: [item] };
		};
		const provider = createHumanTaskCompletionProvider(current, () => []);
		// Exercise the actual queue method on an isolated receiver: no terminal or live editor.
		const start: unknown = Reflect.get(
			Editor.prototype,
			"startAutocompleteRequest",
		);
		assert.equal(typeof start, "function");
		if (typeof start !== "function") assert.fail("native queue method absent");
		const received: Awaited<
			ReturnType<TaskAutocompleteProvider["getSuggestions"]>
		>[] = [];
		const receiver = {
			autocompleteRequestTask: undefined,
			autocompleteStartToken: 1,
			autocompleteProvider: provider,
			autocompleteRequestId: 0,
			state: { cursorLine: 0, cursorCol: 7 },
			getText() {
				return "outside";
			},
			async runAutocompleteRequest() {
				received.push(
					await provider.getSuggestions(["outside"], 0, 7, options),
				);
			},
		};
		await Reflect.apply(start, receiver, [1, {}]);
		await Reflect.apply(start, receiver, [1, {}]);
		assert.equal(calls, 2);
		assert.deepEqual(received, [null, { prefix: "", items: [item] }]);
	});
});
