import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPrintedResources } from "./printed-resources.js";
import type { SkillRefEntry } from "./registry.js";
import { transformReferences } from "./transform-references.js";

const entries: SkillRefEntry[] = [
	{
		kind: "skill",
		name: "a",
		qualifiedName: "skill:a",
		description: "",
		path: "/s/a/SKILL.md",
	},
	{
		kind: "prompt",
		name: "b",
		qualifiedName: "prompt:b",
		description: "",
		path: "/p/b.md",
	},
];
const read = (entry: SkillRefEntry) => entry.name.toUpperCase();

describe("transformReferences", () => {
	it("handles all accepted spacing forms identically", () => {
		for (const gap of ["", " ", "    ", "\t", " \t\t "]) {
			for (const separator of [":", "::"]) {
				assert.equal(
					transformReferences(`use /a${gap}${separator}print.`, entries, read),
					`use /a.${formatPrintedResources(["A"])}`,
				);
				assert.equal(transformReferences(`use /a${gap}${separator}path.`, entries, read), "use /s/a/SKILL.md.");
			}
		}
	});

	it("deduplicates by path, preserves first occurrence order and removes every successful modifier", () => {
		const alias: SkillRefEntry = {
			...entries[0]!,
			name: "alias",
			qualifiedName: "skill:alias",
		};
		assert.equal(
			transformReferences("use /b:print /a :print /alias::print /a::path /a:print", [...entries, alias], read),
			`use /b /a /alias /s/a/SKILL.md /a${formatPrintedResources(["B", "A"])}`,
		);
	});

	it("keeps unsuccessful references intact while converting independent valid ones", () => {
		const ambiguous: SkillRefEntry = {
			...entries[0]!,
			kind: "prompt",
			qualifiedName: "prompt:a",
		};
		const input = "use /a:print /missing :path /B:print /b:path";
		assert.equal(
			transformReferences(input, [...entries, ambiguous], read),
			"use /a:print /missing :path /B:print /p/b.md",
		);
		assert.equal(
			transformReferences("use /a:print /b:path", entries, (entry) => {
				if (entry.name === "a") throw new Error("read failure");
				return "B";
			}),
			"use /a:print /p/b.md",
		);
	});

	it("preserves file contents including frontmatter and does not recursively expand", () => {
		const content = "---\nname: a\n---\n/a:path $ARGUMENTS\n\n";
		assert.equal(
			transformReferences("中文 /a:print", entries, () => content),
			`中文 /a${formatPrintedResources([content])}`,
		);
	});

	it("unescapes without loading or recursively transforming literal output", () => {
		for (const gap of ["", " ", "\t  "]) {
			for (const separator of [":", "::"]) {
				for (const operation of ["print", "path"]) {
					const input = `x /missing${gap}\\${separator}${operation}`;
					assert.equal(
						transformReferences(input, [], () => {
							throw new Error("must not read");
						}),
						`x /missing${gap}${separator}${operation}`,
					);
				}
			}
		}
		assert.equal(
			transformReferences("keep \\:print outside a reference", entries, read),
			"keep \\:print outside a reference",
		);
	});

	it("replaces a bare escaped separator with a literal colon, nothing more", () => {
		assert.equal(transformReferences("x /a \\: ok", entries, read), "x /a : ok");
		assert.equal(transformReferences("x /a \\:anything", entries, read), "x /a :anything");
		assert.equal(transformReferences("x /skill\\:p", [], read), "x /skill:p");
	});

	it("does not rewrite unrelated text, append empty headers or add first-line guards", () => {
		for (const input of ["", "ordinary", "/missing:print", "/a\n:print", "/a:unknown"])
			assert.equal(transformReferences(input, entries, read), input);
		// The first meaningful line's leading reference belongs to pi (P10):
		// :print stays an ordinary argument, verbatim.
		assert.equal(transformReferences("/prompt:b :print", entries, read), "/prompt:b :print");
		assert.equal(formatPrintedResources([]), "");
	});

	it("leaves the first meaningful line's leading reference to pi verbatim", () => {
		assert.equal(transformReferences("/a:print rest", entries, read), "/a:print rest");
		assert.equal(transformReferences("  \n\t/b::path end", entries, read), "  \n\t/b::path end");
		assert.equal(transformReferences("\n/skill\\:print", entries, read), "\n/skill\\:print");
		assert.equal(transformReferences("/x\n/a:print", entries, read), `/x\n/a${formatPrintedResources(["A"])}`);
	});

	it("reuses reads only within a single conversion", () => {
		let reads = 0;
		const reader = () => {
			reads++;
			return "body";
		};
		transformReferences("use /a:print /a:path /a:print", entries, reader);
		assert.equal(reads, 1);
		transformReferences("use /a:path", entries, reader);
		assert.equal(reads, 2);
	});
});
