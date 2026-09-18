import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	escapeCompactionReferenceLiterals,
	expandCompactionReferences,
	formatCompactionReference,
} from "../hooks/compaction-reference-codec.js";
import { buildCompactionReferenceState } from "../hooks/compaction-reference-state.js";
import { user } from "./compaction-reference-fixtures.js";

const diagnostic = "(unresolved compaction reference)";

describe("compaction reference codec", () => {
	it("formats only positive safe ordinals", () => {
		assert.equal(formatCompactionReference(123), "@!123@");
		for (const invalid of [
			0,
			-1,
			NaN,
			Infinity,
			1.5,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			assert.throws(() => formatCompactionReference(invalid), RangeError);
		}
	});

	it("expands direct and adjacent references without source rescanning", () => {
		const state = buildCompactionReferenceState([
			user("raw @!2@ @|!8@ \r\n"),
			user("other"),
		]);
		assert.equal(
			expandCompactionReferences(state, "a@!1@@!2@z"),
			"araw @!2@ @|!8@ \r\notherz",
		);
		assert.equal(expandCompactionReferences(state, "@!2@@!2@"), "otherother");
	});

	it("joins only same-document contiguous summary ranges", () => {
		const line = `${"x".repeat(131)}\n`;
		const state = buildCompactionReferenceState(
			[user("user one"), user("user two")],
			line.repeat(3),
		);
		assert.equal(expandCompactionReferences(state, "@!1~3@"), line.repeat(3));
		assert.equal(
			expandCompactionReferences(state, "@!(1~3)[130:134]@"),
			"x\nxx",
		);
		for (const invalid of [
			"3~4",
			"4~5",
			"2~1",
			"1~99",
			"0",
			"01",
			"9007199254740992",
		]) {
			assert.equal(
				expandCompactionReferences(state, `@!${invalid}@`),
				diagnostic,
			);
		}
	});

	it("uses Unicode half-open, negative, clamped, omitted and alias endpoints", () => {
		const state = buildCompactionReferenceState([user("a😀b\r\n終 ")]);
		const expectations = new Map([
			["1[1:3]", "😀b"],
			["1[-2:]", "終 "],
			["1[..-1]", "a😀b\r\n終"],
			["1[:2]", "a😀"],
			["1[4:1]", ""],
			["1[:]", "a😀b\r\n終 "],
			["1[-999:999]", "a😀b\r\n終 "],
			["1[999:]", ""],
			[`1[-${"9".repeat(90)}:${"9".repeat(90)}]`, "a😀b\r\n終 "],
		]);
		for (const [expression, expected] of expectations)
			assert.equal(
				expandCompactionReferences(state, `@!${expression}@`),
				expected,
			);
	});

	it("rejects unapproved syntax with fixed ID-free diagnostics", () => {
		const state = buildCompactionReferenceState([user("text")]);
		for (const invalid of [
			"",
			"abc",
			"1.trim()",
			"1.pos()",
			"(1)",
			"(1~1)",
			"1~1[:2]",
			"1[-:2]",
			"1[1:2:3]",
			"1[:][:]",
			"1[+1:2]",
			" 1",
			"1\u2028",
			"1[:]\u2029",
		]) {
			assert.equal(
				expandCompactionReferences(state, `@!${invalid}@`),
				invalid === "" ? "" : diagnostic,
			);
		}
	});

	it("lets syntactically complete references own their delimiter before punctuation", () => {
		const state = buildCompactionReferenceState([user("one"), user("two")]);
		assert.equal(expandCompactionReferences(state, "@!1@!"), "one!");
		assert.equal(
			expandCompactionReferences(state, "@!999@!"),
			`${diagnostic}!`,
		);
		assert.equal(
			expandCompactionReferences(state, "@!1~2@!"),
			`${diagnostic}!`,
		);
		assert.equal(
			expandCompactionReferences(state, "@!2~1@!"),
			`${diagnostic}!`,
		);
		assert.equal(expandCompactionReferences(state, "@!@!"), "!");
		assert.equal(expandCompactionReferences(state, "@!1@@!2@!"), "onetwo!");
		assert.equal(
			expandCompactionReferences(state, "@!bad@!1@!"),
			`${diagnostic}one!`,
		);
	});

	it("recovers at line breaks and next prefixes, consumes huge IDs completely", () => {
		const state = buildCompactionReferenceState([user("ok")]);
		assert.equal(
			expandCompactionReferences(state, "@!bad@!1@"),
			`${diagnostic}ok`,
		);
		assert.equal(
			expandCompactionReferences(state, "@!bad@|!1@"),
			`${diagnostic}@!1@`,
		);
		assert.equal(
			expandCompactionReferences(state, "@!999\r\n@!1@"),
			`${diagnostic}\r\nok`,
		);
		assert.equal(
			expandCompactionReferences(state, `@!${"9".repeat(100_000)}@ @!1@`),
			`${diagnostic} ok`,
		);
		assert.equal(
			expandCompactionReferences(state, `@!${"9".repeat(100_000)}`),
			diagnostic,
		);
		assert.equal(expandCompactionReferences(state, "@!@\n@!1@@!@"), "\nok");
	});

	it("round-trips generated literal strings and arbitrary pipe depth exactly", () => {
		const state = buildCompactionReferenceState([
			user("never accidentally insert"),
		]);
		for (let depth = 0; depth < 300; depth++) {
			const raw = `😀@${"|".repeat(depth)}!1@ @!@ @!invalid\r\n@@x|! @!${depth}~7@\t`;
			assert.equal(
				expandCompactionReferences(
					state,
					escapeCompactionReferenceLiterals(raw),
				),
				raw,
			);
		}
	});

	it("checks generated slices against native array slicing", () => {
		for (let size = 0; size < 30; size++) {
			const text = `a😀\r\n終`.repeat(size + 1);
			const points = Array.from(text);
			const state = buildCompactionReferenceState([user(text)]);
			for (
				let start = -points.length - 1;
				start <= points.length + 1;
				start += 7
			) {
				for (
					let end = -points.length - 1;
					end <= points.length + 1;
					end += 11
				) {
					assert.equal(
						expandCompactionReferences(state, `@!1[${start}:${end}]@`),
						points.slice(start, end).join(""),
					);
				}
			}
		}
	});
});
