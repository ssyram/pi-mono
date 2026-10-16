import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBoulderInhibitSignal } from "../../boulder-inhibition/parse-signal.ts";

test("decode: ordinary valid signals preserve exact source spelling and boolean values", () => {
	for (const type of ["loop", "Loop", "user", "provider/Name", "__proto__", "constructor", "toString", "来源"]) {
		for (const value of [true, false]) {
			const data = Object.freeze({ type, value, ignored: { extra: true } });
			const first = parseBoulderInhibitSignal(data);
			const second = parseBoulderInhibitSignal(data);
			assert.deepEqual(first, { type, value });
			assert.deepEqual(second, { type, value });
			assert.notStrictEqual(first, data);
			assert.notStrictEqual(first, second);
			assert.deepEqual(data, { type, value, ignored: { extra: true } });
		}
	}
});

test("decode: malformed data never produces a signal", () => {
	const malformed: unknown[] = [
		undefined, null, true, false, 0, 1, "loop", Symbol("loop"), 1n, () => false,
		[], [{ type: "loop", value: true }], Object.assign([], { type: "loop", value: true }),
		{}, { type: "loop" }, { value: true }, { type: "", value: true },
		{ type: null, value: true }, { type: 1, value: true }, { type: ["loop"], value: true },
		{ type: new String("loop"), value: true }, { type: "loop", value: new Boolean(false) },
		{ type: "loop", value: "true" }, { type: "loop", value: "false" },
		{ type: "loop", value: 0 }, { type: "loop", value: 1 },
		{ type: "loop", value: null }, { type: "loop", value: undefined },
	];
	for (const [index, data] of malformed.entries()) {
		assert.equal(parseBoulderInhibitSignal(data), undefined, `malformed case ${index}`);
	}
});

test("decode: whitespace anywhere in the source invalidates it", () => {
	for (const space of [" ", "\t", "\n", "\r", "\v", "\f", "\u00a0", "\u2003", "\u2028", "\u2029", "\ufeff"]) {
		for (const type of [space, `${space}loop`, `lo${space}op`, `loop${space}`]) {
			assert.equal(parseBoulderInhibitSignal({ type, value: true }), undefined);
		}
	}
});

test("decode: input and output remain detached in both mutation directions", () => {
	const data = { type: "loop", value: true, extra: "not part of the signal" };
	const signal = parseBoulderInhibitSignal(data);
	if (!signal) assert.fail("expected a valid signal");
	data.type = "user";
	data.value = false;
	assert.deepEqual(signal, { type: "loop", value: true });
	signal.type = "changed";
	signal.value = false;
	assert.deepEqual(data, { type: "user", value: false, extra: "not part of the signal" });
});
