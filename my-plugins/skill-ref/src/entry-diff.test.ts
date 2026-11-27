import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDelta, nameDelta, sameEntries } from "./entry-diff.js";
import type { SkillRefEntry } from "./registry.js";

function entry(name: string, path = `/${name}/SKILL.md`): SkillRefEntry {
	return { kind: "skill", name, qualifiedName: `skill:${name}`, description: "", path };
}

describe("sameEntries", () => {
	it("is order-insensitive over (name, path) pairs", () => {
		assert.ok(sameEntries([entry("a"), entry("b")], [entry("b"), entry("a")]));
	});

	it("notices a moved file and a different length", () => {
		assert.ok(!sameEntries([entry("a")], [entry("a", "/moved/SKILL.md")]));
		assert.ok(!sameEntries([entry("a")], []));
	});
});

describe("nameDelta", () => {
	it("counts names only on one side", () => {
		assert.deepEqual(nameDelta([entry("a"), entry("b")], [entry("b"), entry("c"), entry("d")]), {
			added: 2,
			removed: 1,
		});
	});

	it("ignores a path-only change", () => {
		assert.deepEqual(nameDelta([entry("a")], [entry("a", "/moved/SKILL.md")]), { added: 0, removed: 0 });
	});
});

describe("formatDelta", () => {
	it("is silent when nothing changed", () => {
		assert.equal(formatDelta({ added: 0, removed: 0 }), null);
	});

	it("reads equal counts as a plain change", () => {
		assert.equal(formatDelta({ added: 2, removed: 2 }), "Skill list changed");
	});

	it("spells out unequal counts", () => {
		assert.equal(formatDelta({ added: 3, removed: 0 }), "Skill list changed: +3/-0 skill(s)");
		assert.equal(formatDelta({ added: 0, removed: 1 }), "Skill list changed: +0/-1 skill(s)");
		assert.equal(formatDelta({ added: 2, removed: 1 }), "Skill list changed: +2/-1 skill(s)");
	});
});
