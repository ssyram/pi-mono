import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompactionReferenceState } from "../hooks/compaction-reference-state.js";
import { assistant, tool, user } from "./compaction-reference-fixtures.js";

describe("compaction reference state", () => {
	it("partitions only exact terminal file sections and preserves every character", () => {
		for (const suffix of [
			"\n\n<read-files>\na.ts\n</read-files>",
			"\n\n<modified-files>\nb.ts\n</modified-files>",
			"\n\n<read-files>\na.ts\n</read-files>\n\n<modified-files>\nb.ts\n</modified-files>",
		]) {
			const state = buildCompactionReferenceState([], `body \r\n${suffix}`);
			assert.equal(state.fileSuffix, suffix);
			assert.equal(state.sources.map((s) => s.text).join(""), "body \r\n");
			assert.equal(
				state.sources.map((s) => s.text).join("") + state.fileSuffix,
				`body \r\n${suffix}`,
			);
		}
	});

	it("does not infer metadata from file mentions, nonterminal tags or trailing whitespace", () => {
		for (const summary of [
			"Files: a.ts and b.ts",
			"body\n\n<read-files>\na.ts\n</read-files>\n",
			"body\r\n\r\n<read-files>\r\na.ts\r\n</read-files>",
			"body\n\n<read-files>\na.ts\n</read-files>\nmore prose",
			"body\n\n<read-files>\n\n</read-files>",
		]) {
			const state = buildCompactionReferenceState([], summary);
			assert.equal(state.fileSuffix, "");
			assert.equal(state.sources.map((s) => s.text).join(""), summary);
		}
	});

	it("documents identical terminal prose and rightmost-delimiter ambiguity", () => {
		const suffix = "\n\n<read-files>\ninner\n</read-files>";
		const body = "body\n\n<read-files>\nouter";
		const state = buildCompactionReferenceState([], body + suffix);
		assert.equal(state.fileSuffix, suffix);
		assert.equal(state.sources.map((s) => s.text).join(""), body);
	});

	it("uses whole lines, 33 times actual marker width, and code points", () => {
		const line = `${"😀".repeat(131)}\n`;
		const state = buildCompactionReferenceState([], line.repeat(12));
		assert.equal(state.sources.length, 11);
		assert.equal(state.sources[8].text, line);
		assert.equal(state.sources[9].text, line.repeat(2));
		assert.equal(state.sources[10].text, line);
		assert.equal(state.sources.map((s) => s.text).join(""), line.repeat(12));
	});

	it("never cuts long physical lines and retains mixed terminators and short tail", () => {
		const huge = `${"x".repeat(10_000)}\r\n`;
		const tail = "a\rb\n😀\r\n \t";
		const state = buildCompactionReferenceState([], huge + tail);
		assert.deepEqual(
			state.sources.map((s) => s.text),
			[huge, tail],
		);
		assert.equal(buildCompactionReferenceState([]).sources.length, 0);
	});

	it("indexes each nonempty pure-text user occurrence whole, not other roles or mixed media", () => {
		const image = {
			type: "image" as const,
			data: "AA==",
			mimeType: "image/png",
		};
		const messages = [
			user(""),
			user([]),
			user([{ type: "text", text: "" }]),
			user([image]),
			user([{ type: "text", text: "mixed" }, image]),
			assistant([{ type: "text", text: "answer" }]),
			tool("result"),
			user(" \t"),
			user([
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			]),
			user("long".repeat(10_000)),
		];
		const state = buildCompactionReferenceState(messages, "summary");
		assert.deepEqual(
			state.sources.map((s) => [s.document, s.text]),
			[
				[0, "summary"],
				[8, " \t"],
				[9, "ab"],
				[10, "long".repeat(10_000)],
			],
		);
		assert.deepEqual(state.userOrdinals, [
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			2,
			3,
			4,
		]);
	});

	it("snapshots strings with occurrence identity and no cross-call state", () => {
		const message = user("same");
		const first = buildCompactionReferenceState([message, message]);
		message.content = "changed";
		const second = buildCompactionReferenceState([message]);
		assert.deepEqual(
			first.sources.map((s) => [s.ordinal, s.document, s.text]),
			[
				[1, 1, "same"],
				[2, 2, "same"],
			],
		);
		assert.equal(second.sources[0].ordinal, 1);
		assert.equal(second.sources[0].text, "changed");
		assert.ok(
			Object.isFrozen(first) &&
				Object.isFrozen(first.sources) &&
				Object.isFrozen(first.userOrdinals),
		);
		assert.ok(first.sources.every(Object.isFrozen));
		assert.equal(Reflect.set(first.sources[0], "text", "modified"), false);
	});

	it("reconstructs generated line streams across 9/10 and 99/100 label widths", () => {
		for (let seed = 0; seed < 40; seed++) {
			const lines = Array.from(
				{ length: 350 },
				(_, i) =>
					`${"α😀x".repeat((i * 17 + seed) % 70)}${["\n", "\r", "\r\n"][i % 3]}`,
			);
			const summary = `${lines.join("")}tail`;
			const state = buildCompactionReferenceState([], summary);
			assert.equal(state.sources.map((s) => s.text).join(""), summary);
			let consumed = 0;
			for (let i = 0; i < state.sources.length; i++) {
				const source = state.sources[i];
				assert.equal(source.ordinal, i + 1);
				if (i < state.sources.length - 1) {
					assert.ok(
						Array.from(source.text).length >= 33 * `@!${i + 1}@`.length,
					);
					assert.match(source.text, /[\r\n]$/);
				}
				consumed += source.text.length;
				assert.notEqual(summary.slice(consumed - 1, consumed + 1), "\r\n");
			}
			assert.ok(state.sources.length > 100);
		}
	});
});
