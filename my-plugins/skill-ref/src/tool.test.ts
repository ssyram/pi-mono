import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SkillRefEntry } from "./registry.js";
import { resolveQuery } from "./tool.js";

function entry(kind: "skill" | "prompt", name: string, description = ""): SkillRefEntry {
	return {
		kind,
		name,
		qualifiedName: `${kind}:${name}`,
		description,
		path: `/${kind}s/${name}.md`,
		baseDir: `/${kind}s`,
	};
}

const ENTRIES: SkillRefEntry[] = [
	entry("skill", "qpdi", "constitutional workflow"),
	entry("skill", "workflow", "development process"),
	entry("prompt", "qpdi", "prompt with the same name"),
	entry("prompt", "pr-craft", "pull request description"),
];

const read = (e: SkillRefEntry) => `BODY OF ${e.qualifiedName}`;

describe("resolveQuery — exact hit", () => {
	it("returns one confirmation line naming the identifier and path, then the text", () => {
		const { text, details } = resolveQuery(ENTRIES, { query: "workflow" }, read);
		assert.equal(details.mode, "exact");
		assert.equal(details.matched, "skill:workflow");
		const [first, ...rest] = text.split("\n");
		assert.equal(first, "/skill:workflow loaded successfully from /skills/workflow.md");
		assert.equal(rest.join("\n"), "BODY OF skill:workflow");
	});

	it("accepts a leading slash and a qualified name", () => {
		assert.equal(resolveQuery(ENTRIES, { query: "/workflow" }, read).details.matched, "skill:workflow");
		assert.equal(resolveQuery(ENTRIES, { query: "prompt:qpdi" }, read).details.matched, "prompt:qpdi");
	});

	it("offers rather than loads when only the case differs", () => {
		const { text, details } = resolveQuery(ENTRIES, { query: "WorkFlow" }, read);
		assert.equal(details.matched, null);
		assert.deepEqual(details.candidates, ["skill:workflow"]);
		assert.ok(!text.includes("BODY OF"));
		assert.ok(text.includes("- /skill:workflow"));
	});

	it("surfaces a read failure as a throw, not as silent text", () => {
		assert.throws(
			() =>
				resolveQuery(ENTRIES, { query: "workflow" }, () => {
					throw new Error("EACCES");
				}),
			/EACCES/,
		);
	});
});

describe("resolveQuery — shared name", () => {
	it("reports ambiguity instead of guessing", () => {
		const { text, details } = resolveQuery(ENTRIES, { query: "qpdi" }, read);
		assert.equal(details.mode, "ambiguous");
		assert.deepEqual(details.candidates, ["skill:qpdi", "prompt:qpdi"]);
		assert.ok(text.includes("- /skill:qpdi"));
		assert.ok(text.includes("- /prompt:qpdi"));
	});

	it("resolves once the identifier is qualified", () => {
		assert.equal(resolveQuery(ENTRIES, { query: "prompt:qpdi" }, read).details.matched, "prompt:qpdi");
		assert.equal(resolveQuery(ENTRIES, { query: "skill:qpdi" }, read).details.matched, "skill:qpdi");
	});

	it("does not leak file paths into a listing", () => {
		const { text } = resolveQuery(ENTRIES, { query: "qpdi" }, read);
		assert.ok(!text.includes(".md"));
	});
});

describe("resolveQuery — spellings that differ only in case", () => {
	// skill:abc, prompt:Abc and prompt:abc can all be loaded by pi at once.
	const MIXED: SkillRefEntry[] = [entry("skill", "abc"), entry("prompt", "Abc"), entry("prompt", "abc")];

	it("loads only on a unique exact-case hit", () => {
		assert.equal(resolveQuery(MIXED, { query: "Abc" }, read).details.matched, "prompt:Abc");
		assert.equal(resolveQuery(MIXED, { query: "prompt:abc" }, read).details.matched, "prompt:abc");
		assert.equal(resolveQuery(MIXED, { query: "prompt:Abc" }, read).details.matched, "prompt:Abc");
		assert.equal(resolveQuery(MIXED, { query: "skill:abc" }, read).details.matched, "skill:abc");
	});

	it("offers every case-insensitive match when the exact hit is not unique", () => {
		const { details } = resolveQuery(MIXED, { query: "abc" }, read);
		assert.equal(details.mode, "ambiguous");
		assert.deepEqual(details.candidates, ["skill:abc", "prompt:Abc", "prompt:abc"]);
	});

	it("offers the same set when no exact-case spelling matches", () => {
		const { details } = resolveQuery(MIXED, { query: "ABC" }, read);
		assert.equal(details.mode, "ambiguous");
		assert.deepEqual(details.candidates, ["skill:abc", "prompt:Abc", "prompt:abc"]);
	});

	it("keeps every offered identifier individually loadable", () => {
		const { details } = resolveQuery(MIXED, { query: "abc" }, read);
		for (const candidate of details.candidates) {
			assert.equal(resolveQuery(MIXED, { query: candidate }, read).details.matched, candidate);
		}
	});
});

describe("resolveQuery — no exact hit", () => {
	it("lists fuzzy candidates as qualified identifiers", () => {
		const { text, details } = resolveQuery(ENTRIES, { query: "wkf" }, read);
		assert.equal(details.mode, "candidates");
		assert.ok(text.includes("- /skill:workflow"));
		assert.ok(!text.includes(".md"));
	});

	it("qualifies both holders of a shared name", () => {
		const { text } = resolveQuery(ENTRIES, { query: "q.d" }, read);
		assert.ok(text.includes("- /skill:qpdi"));
		assert.ok(text.includes("- /prompt:qpdi"));
	});

	it("falls back to the full name listing when nothing matches", () => {
		const { text, details } = resolveQuery(ENTRIES, { query: "zzzz" }, read);
		assert.equal(details.mode, "none");
		assert.ok(text.includes("/skill:workflow"));
		assert.ok(text.includes("/prompt:qpdi"));
	});

	it("renders a description-less entry as a bare identifier", () => {
		// pi refuses to load a skill without a description, and falls back to the
		// body's first line (60 chars) for a prompt, so this is the residual case:
		// a prompt file with nothing in it.
		const bare: SkillRefEntry[] = [{ ...entry("prompt", "blank"), description: "" }];
		const { text } = resolveQuery(bare, { query: "bl" }, read);
		assert.ok(text.includes("- /prompt:blank\n"));
		assert.ok(!text.includes("—"));
	});

	it("reports an empty session honestly", () => {
		const { text, details } = resolveQuery([], { query: "anything" }, read);
		assert.equal(details.mode, "none");
		assert.ok(text.includes("No skill or prompt is loaded"));
	});

	it("clamps the limit", () => {
		assert.equal(resolveQuery(ENTRIES, { query: "", limit: 0 }, read).details.mode, "candidates");
		assert.equal(resolveQuery(ENTRIES, { query: "", limit: 1 }, read).details.candidates.length, 1);
	});
});
