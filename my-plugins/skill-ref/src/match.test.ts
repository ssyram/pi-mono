import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileQuery, findExact, findExactIgnoringCase, findFuzzy, normalizeQuery, stripWildcards } from "./match.js";
import type { SkillRefEntry } from "./registry.js";

function entry(kind: "skill" | "prompt", name: string, description = ""): SkillRefEntry {
	return { kind, name, qualifiedName: `${kind}:${name}`, description, path: `/tmp/${name}.md` };
}

const ENTRIES: SkillRefEntry[] = [
	entry("skill", "qpdi", "constitutional workflow"),
	entry("skill", "workflow", "development process spec"),
	entry("skill", "hoare-audit", "iterative correctness verification"),
	entry("prompt", "pr-craft", "pull request description"),
	entry("prompt", "qpdi", "prompt sharing a skill name"),
];

describe("compileQuery", () => {
	it("treats a plain query as an ordered subsequence", () => {
		const re = compileQuery("abc");
		assert.equal(re.source, ".*a.*b.*c.*");
		assert.ok(re.test("a-b-c"));
		assert.ok(re.test("xxAxxBxxC"));
		assert.ok(!re.test("acb"));
	});

	it("treats . and * as wildcards, not literals", () => {
		assert.equal(compileQuery("x...a").source, ".*x.*a.*");
		assert.equal(compileQuery("x..a").source, compileQuery("x...a").source);
		assert.equal(compileQuery("x*a").source, ".*x.*a.*");
		assert.ok(compileQuery("x...a").test("extra"));
	});

	it("matches everything on an empty or wildcard-only query", () => {
		assert.ok(compileQuery("").test("anything"));
		assert.ok(compileQuery("...").test("anything"));
	});

	it("does not break on regex metacharacters", () => {
		assert.doesNotThrow(() => compileQuery("c++"));
		assert.doesNotThrow(() => compileQuery("a(b[c]"));
		assert.ok(compileQuery("c++").test("c++ notes"));
		assert.ok(!compileQuery("c++").test("cxx"));
	});

	it("is case insensitive", () => {
		assert.ok(compileQuery("QP").test("qpdi"));
	});
});

describe("normalizeQuery / stripWildcards", () => {
	it("drops surrounding space and leading slashes", () => {
		assert.equal(normalizeQuery("  /foo "), "foo");
		assert.equal(normalizeQuery("//foo"), "foo");
		assert.equal(normalizeQuery("foo"), "foo");
	});

	it("keeps inner slashes and colons", () => {
		assert.equal(normalizeQuery("/skill:foo"), "skill:foo");
	});

	it("removes only wildcard characters", () => {
		assert.equal(stripWildcards("x...a*b"), "xab");
	});
});

describe("findExact", () => {
	it("accepts the bare name with or without a slash", () => {
		assert.deepEqual(
			findExact(ENTRIES, "workflow").map((e) => e.qualifiedName),
			["skill:workflow"],
		);
		assert.deepEqual(
			findExact(ENTRIES, "/workflow").map((e) => e.qualifiedName),
			["skill:workflow"],
		);
	});

	it("accepts qualified names", () => {
		assert.deepEqual(
			findExact(ENTRIES, "prompt:qpdi").map((e) => e.qualifiedName),
			["prompt:qpdi"],
		);
		assert.deepEqual(
			findExact(ENTRIES, "/skill:qpdi").map((e) => e.qualifiedName),
			["skill:qpdi"],
		);
	});

	it("is case sensitive — a different case is not an exact match", () => {
		assert.deepEqual(findExact(ENTRIES, "/WORKFLOW"), []);
		assert.deepEqual(findExact(ENTRIES, "SKILL:QPDI"), []);
	});

	it("returns every hit when a skill and a prompt share a name", () => {
		assert.deepEqual(
			findExact(ENTRIES, "qpdi").map((e) => e.qualifiedName),
			["skill:qpdi", "prompt:qpdi"],
		);
	});

	it("returns nothing for an empty query", () => {
		assert.deepEqual(findExact(ENTRIES, ""), []);
		assert.deepEqual(findExact(ENTRIES, "/"), []);
	});
});

describe("findExact / findExactIgnoringCase — mixed case", () => {
	// pi dedupes through case-sensitive maps, so these three can all be loaded.
	const MIXED: SkillRefEntry[] = [entry("skill", "abc"), entry("prompt", "Abc"), entry("prompt", "abc")];

	it("separates spellings that differ only in case", () => {
		assert.deepEqual(
			findExact(MIXED, "Abc").map((e) => e.qualifiedName),
			["prompt:Abc"],
		);
		assert.deepEqual(
			findExact(MIXED, "abc").map((e) => e.qualifiedName),
			["skill:abc", "prompt:abc"],
		);
	});

	it("makes the qualified name a working escape hatch", () => {
		assert.deepEqual(
			findExact(MIXED, "prompt:abc").map((e) => e.qualifiedName),
			["prompt:abc"],
		);
		assert.deepEqual(
			findExact(MIXED, "prompt:Abc").map((e) => e.qualifiedName),
			["prompt:Abc"],
		);
	});

	it("offers every spelling when case is ignored", () => {
		for (const query of ["abc", "Abc", "ABC"]) {
			assert.deepEqual(
				findExactIgnoringCase(MIXED, query).map((e) => e.qualifiedName),
				["skill:abc", "prompt:Abc", "prompt:abc"],
			);
		}
	});

	it("ignores case for qualified names too", () => {
		assert.deepEqual(
			findExactIgnoringCase(MIXED, "PROMPT:ABC").map((e) => e.qualifiedName),
			["prompt:Abc", "prompt:abc"],
		);
	});
});

describe("kind prefix", () => {
	const MIXED: SkillRefEntry[] = [entry("skill", "abc"), entry("prompt", "Abc"), entry("prompt", "abc")];

	it("is case insensitive while the name is not", () => {
		assert.deepEqual(
			findExact(MIXED, "PROMPT:Abc").map((e) => e.qualifiedName),
			["prompt:Abc"],
		);
		assert.deepEqual(
			findExact(MIXED, "Skill:abc").map((e) => e.qualifiedName),
			["skill:abc"],
		);
		assert.deepEqual(findExact(MIXED, "SKILL:Abc"), []);
		assert.deepEqual(findExact(ENTRIES, "skill:WORKFLOW"), []);
	});

	it("scopes a loose search to the named kind", () => {
		assert.deepEqual(
			findFuzzy(ENTRIES, "SKILL:wkf", 10).map((e) => e.qualifiedName),
			["skill:workflow"],
		);
		assert.deepEqual(
			findFuzzy(ENTRIES, "prompt:qpdi", 10).map((e) => e.qualifiedName),
			["prompt:qpdi"],
		);
	});

	it("does not hide a resource whose own name looks like a qualified one", () => {
		const odd: SkillRefEntry[] = [entry("prompt", "skill:foo"), entry("skill", "foo")];
		assert.deepEqual(
			findExact(odd, "skill:foo").map((e) => e.qualifiedName),
			["prompt:skill:foo", "skill:foo"],
		);
	});
});

describe("findFuzzy", () => {
	it("matches by subsequence", () => {
		assert.deepEqual(
			findFuzzy(ENTRIES, "wkf", 10).map((e) => e.name),
			["workflow"],
		);
	});

	it("honours wildcard queries", () => {
		assert.deepEqual(
			findFuzzy(ENTRIES, "h...audit", 10).map((e) => e.name),
			["hoare-audit"],
		);
	});

	it("prefers name matches and never mixes in description-only hits", () => {
		const names = findFuzzy(ENTRIES, "qpdi", 10).map((e) => e.qualifiedName);
		assert.deepEqual(names, ["skill:qpdi", "prompt:qpdi"]);
	});

	it("falls back to descriptions only when no name matches", () => {
		assert.deepEqual(
			findFuzzy(ENTRIES, "correctness", 10).map((e) => e.name),
			["hoare-audit"],
		);
	});

	it("returns everything for an empty query and respects the limit", () => {
		assert.equal(findFuzzy(ENTRIES, "", 100).length, ENTRIES.length);
		assert.equal(findFuzzy(ENTRIES, "", 2).length, 2);
	});

	it("returns nothing when there is no match at all", () => {
		assert.deepEqual(findFuzzy(ENTRIES, "zzzz", 10), []);
	});

	it("orders deterministically: better score first, then shorter name, then name", () => {
		// "ab" scores best (consecutive match); "acb" and "aab" tie on score and
		// length, so the name decides.
		const ties: SkillRefEntry[] = [entry("skill", "acb"), entry("skill", "aab"), entry("prompt", "ab")];
		assert.deepEqual(
			findFuzzy(ties, "ab", 10).map((e) => e.name),
			["ab", "aab", "acb"],
		);
	});
});
