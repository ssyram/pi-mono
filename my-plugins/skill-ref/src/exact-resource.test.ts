import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { loadExactReference } from "./exact-resource.js";
import type { SkillRefEntry } from "./registry.js";

const skill: SkillRefEntry = {
	kind: "skill",
	name: "alpha",
	qualifiedName: "skill:alpha",
	description: "",
	path: "/s/alpha/SKILL.md",
};

describe("loadExactReference", () => {
	it("loads only unique exact same-case resources", () => {
		assert.deepEqual(
			loadExactReference([skill], "/alpha", () => "body"),
			{ entry: skill, content: "body" },
		);
		assert.ok(loadExactReference([skill], "/SKILL:alpha", () => "body"));
		for (const query of ["Alpha", "al", "missing"])
			assert.equal(
				loadExactReference([skill], query, () => "body"),
				null,
			);
	});

	it("returns null for ambiguity without reading and accepts qualified disambiguation", () => {
		const prompt: SkillRefEntry = {
			...skill,
			kind: "prompt",
			qualifiedName: "prompt:alpha",
			path: "/p/alpha.md",
		};
		let reads = 0;
		const read = () => {
			reads++;
			return "body";
		};
		assert.equal(loadExactReference([skill, prompt], "alpha", read), null);
		assert.equal(reads, 0);
		assert.deepEqual(loadExactReference([skill, prompt], "prompt:alpha", read)?.entry, prompt);
	});

	it("contains read and metadata exceptions and rejects invalid content and paths", () => {
		assert.equal(
			loadExactReference([skill], "alpha", () => {
				throw new Error("read");
			}),
			null,
		);
		assert.equal(
			loadExactReference([skill], "alpha", () => undefined as unknown as string),
			null,
		);
		for (const path of ["", "relative.md"])
			assert.equal(
				loadExactReference([{ ...skill, path }], "alpha", () => "body"),
				null,
			);
		const broken = {
			...skill,
			get name(): string {
				throw new Error("metadata");
			},
		};
		assert.equal(
			loadExactReference([broken], "alpha", () => "body"),
			null,
		);
	});

	it("reads UTF-8 verbatim with the default filesystem reader", () => {
		const parent = resolve("my-plugins/skill-ref/.pi");
		mkdirSync(parent, { recursive: true });
		const directory = mkdtempSync(join(parent, "modifier-resource-"));
		const path = join(directory, "SKILL.md");
		const content = "---\nname: alpha\n---\n正文 $ARGUMENTS\n\n";
		try {
			writeFileSync(path, content);
			assert.equal(loadExactReference([{ ...skill, path }], "alpha")?.content, content);
			assert.equal(loadExactReference([{ ...skill, path: join(directory, "missing.md") }], "alpha"), null);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("returns a defensive copy so reader mutation cannot corrupt the loaded path", () => {
		const loaded = loadExactReference([skill], "alpha", (entry) => {
			entry.path = "relative.md";
			return "body";
		});
		assert.notEqual(loaded?.entry, skill);
		assert.equal(loaded?.entry.path, "/s/alpha/SKILL.md");
	});

	it("degrades to null when a reader sabotages the entry after a successful read", () => {
		const sabotaged = loadExactReference([skill], "alpha", (entry) => {
			Object.defineProperty(entry, "path", {
				get(): string {
					throw new Error("mutated");
				},
			});
			return "body";
		});
		assert.equal(sabotaged, null);
	});
});
