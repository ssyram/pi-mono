import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createSkillRefProvider, extractInlineSlashToken } from "./autocomplete.js";
import type { SkillRefEntry } from "./registry.js";

const ENTRIES: SkillRefEntry[] = [
	{ kind: "skill", name: "qpdi", qualifiedName: "skill:qpdi", description: "workflow", path: "/s/qpdi/SKILL.md" },
	{ kind: "prompt", name: "pr-craft", qualifiedName: "prompt:pr-craft", description: "PR text", path: "/p/pr.md" },
];

const getEntries = () => ENTRIES;

// Stand-in for pi's theme: real SGR codes with a foreground-only reset, like Theme.fg.
const COLORS: Record<string, string> = { accent: "\x1b[36m", success: "\x1b[32m", muted: "\x1b[90m" };
const theme = { fg: (color: string, text: string) => `${COLORS[color] ?? ""}${text}\x1b[39m` };

function makeCurrent() {
	const calls: string[] = [];
	const current = {
		async getSuggestions() {
			calls.push("getSuggestions");
			return { items: [{ value: "/etc/", label: "etc/" }], prefix: "/e" };
		},
		applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
			calls.push("applyCompletion");
			return { lines, cursorLine, cursorCol };
		},
		shouldTriggerFileCompletion() {
			return true;
		},
	};
	return { current, calls };
}

const options = { signal: new AbortController().signal, force: true };

describe("extractInlineSlashToken", () => {
	it("returns null unless the completion was forced (Tab)", () => {
		assert.equal(extractInlineSlashToken(["hello /qp"], 0, 9, false), null);
	});

	it("picks up a mid-sentence slash token", () => {
		assert.deepEqual(extractInlineSlashToken(["hello /qp"], 0, 9, true), { token: "/qp", start: 6 });
	});

	it("leaves a line-leading slash to the native menu", () => {
		assert.equal(extractInlineSlashToken(["/qp"], 0, 3, true), null);
		assert.equal(extractInlineSlashToken(["   /qp"], 0, 6, true), null);
	});

	it("ignores tokens that do not start with a slash", () => {
		assert.equal(extractInlineSlashToken(["see @src/f"], 0, 10, true), null);
		assert.equal(extractInlineSlashToken(["see src/f"], 0, 9, true), null);
	});

	it("treats a quote as a token boundary", () => {
		assert.deepEqual(extractInlineSlashToken(['say "/qp'], 0, 8, true), { token: "/qp", start: 5 });
	});

	it("keeps colons and inner slashes inside one token", () => {
		assert.deepEqual(extractInlineSlashToken(["use /skill:qp"], 0, 13, true), { token: "/skill:qp", start: 4 });
	});

	it("handles a bare slash and a cursor before the end of the line", () => {
		assert.deepEqual(extractInlineSlashToken(["hello / world"], 0, 7, true), { token: "/", start: 6 });
	});
});

describe("createSkillRefProvider.getSuggestions", () => {
	it("delegates everything that is not a mid-sentence slash", async () => {
		const { current, calls } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		await provider.getSuggestions(["hello /qp"], 0, 9, { ...options, force: false });
		await provider.getSuggestions(["see @src/f"], 0, 10, options);
		assert.deepEqual(calls, ["getSuggestions", "getSuggestions"]);
	});

	it("offers skills and prompts for a mid-sentence slash", async () => {
		const { current, calls } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		const result = await provider.getSuggestions(["hello /qp"], 0, 9, options);
		assert.deepEqual(calls, []);
		assert.equal(result?.prefix, "/qp");
		assert.deepEqual(
			result?.items.map((item) => item.value),
			["/qpdi"],
		);
	});

	it("lists everything for a bare slash", async () => {
		const { current } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		const result = await provider.getSuggestions(["hello /"], 0, 7, options);
		assert.equal(result?.items.length, ENTRIES.length);
	});

	it("shows nothing rather than falling back to paths when nothing matches", async () => {
		const { current, calls } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		const result = await provider.getSuggestions(["hello /zzzz"], 0, 11, options);
		assert.equal(result, null);
		assert.deepEqual(calls, []);
	});
});

describe("createSkillRefProvider colouring", () => {
	it("colours the kind tag without changing the rendered width", async () => {
		const { current } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		const result = await provider.getSuggestions(["hello /qp"], 0, 9, options);
		const description = result?.items[0]?.description ?? "";
		assert.ok(description.includes(`${COLORS.accent}skill`));
		assert.equal(visibleWidth(description), visibleWidth("skill · workflow"));
	});

	it("ends coloured spans with a foreground-only reset", async () => {
		const { current } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		const result = await provider.getSuggestions(["hello /qp"], 0, 9, options);
		assert.ok(!(result?.items[0]?.description ?? "").includes("\x1b[0m"));
	});

	it("works without a theme", async () => {
		const { current } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries);
		const result = await provider.getSuggestions(["hello /qp"], 0, 9, options);
		assert.equal(result?.items[0]?.description, "skill · workflow");
	});
});

describe("createSkillRefProvider.applyCompletion", () => {
	it("replaces the token and leaves a trailing space", () => {
		const { current, calls } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		const result = provider.applyCompletion(["hello /qp world"], 0, 9, { value: "/qpdi", label: "/qpdi" }, "/qp");
		assert.deepEqual(calls, []);
		assert.deepEqual(result.lines, ["hello /qpdi  world"]);
		assert.equal(result.cursorCol, 12);
	});

	it("delegates when the item did not come from us", () => {
		const { current, calls } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		provider.applyCompletion(["hello /us"], 0, 9, { value: "/usr/", label: "usr/" }, "/us");
		assert.deepEqual(calls, ["applyCompletion"]);
	});

	it("delegates when the prefix does not match the token under the cursor", () => {
		const { current, calls } = makeCurrent();
		const provider = createSkillRefProvider(current, getEntries, theme);
		provider.applyCompletion(["@foo /qp"], 0, 8, { value: "/qpdi", label: "/qpdi" }, "@foo");
		assert.deepEqual(calls, ["applyCompletion"]);
	});
});
