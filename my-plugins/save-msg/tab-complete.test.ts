import { describe, expect, it } from "vitest";
import { type ArgumentCandidate, createCommandArgumentProvider, matchesLoosely, parseCommandArguments } from "./tab-complete.js";

const parse = (line: string, col = line.length) => parseCommandArguments([line], 0, col, "save-msg");

const OPTIONS: ArgumentCandidate[] = [
	{ value: "--pick" },
	{ value: "--with-tools" },
	{ value: "--raw" },
	{ value: "--append" },
	{ value: "--no-header" },
	{ value: "--help" },
];

// Same predicate command.ts installs.
const complete = (previousTokens: string[], token: string): ArgumentCandidate[] | null => {
	if (token && !token.startsWith("-")) return null;
	const used = new Set(previousTokens);
	const remaining = OPTIONS.filter((c) => !used.has(c.value));
	return remaining.length > 0 ? remaining : null;
};

function makeCurrent() {
	const calls: string[] = [];
	const current = {
		async getSuggestions() {
			calls.push("getSuggestions");
			return { items: [{ value: "out.md", label: "out.md" }], prefix: "" };
		},
		applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
			calls.push("applyCompletion");
			return { lines, cursorLine, cursorCol };
		},
	};
	return { current, calls };
}

const provider = (current: Parameters<typeof createCommandArgumentProvider>[0]) =>
	createCommandArgumentProvider(current, { command: "save-msg", complete });

const options = { signal: new AbortController().signal, force: true };

describe("matchesLoosely", () => {
	it("matches a subsequence, ignoring case", () => {
		expect(matchesLoosely("wt", "--with-tools")).toBe(true);
		expect(matchesLoosely("NH", "--no-header")).toBe(true);
		expect(matchesLoosely("tw", "--with-tools")).toBe(false);
	});
});

describe("parseCommandArguments", () => {
	it("needs whitespace after the command name", () => {
		expect(parse("/save-msg")).toBeNull();
		expect(parse("/save-msg ")).toEqual({ previousTokens: [], token: "", tokenStart: 10 });
	});

	it("tracks the options already typed", () => {
		expect(parse("/save-msg --raw --w")).toEqual({ previousTokens: ["--raw"], token: "--w", tokenStart: 16 });
	});

	it("ignores other commands", () => {
		expect(parse("/impression set")).toBeNull();
	});
});

describe("save-msg option menu", () => {
	it("lists every option right after the command", async () => {
		const { current, calls } = makeCurrent();
		const result = await provider(current).getSuggestions(["/save-msg "], 0, 10, options);
		expect(calls).toEqual([]);
		expect(result?.items.map((i) => i.value)).toEqual(OPTIONS.map((c) => c.value));
	});

	it("narrows on the typed token, prefix matches first", async () => {
		const { current } = makeCurrent();
		const result = await provider(current).getSuggestions(["/save-msg --w"], 0, 13, options);
		// "--raw" also matches loosely ("-", "-", "w" is a subsequence of it), but
		// only "--with-tools" starts with the token, so it leads.
		expect(result?.items.map((i) => i.value)).toEqual(["--with-tools", "--raw"]);
	});

	it("drops options that are already present", async () => {
		const { current } = makeCurrent();
		const result = await provider(current).getSuggestions(["/save-msg --raw "], 0, 16, options);
		expect(result?.items.map((i) => i.value)).not.toContain("--raw");
		expect(result?.items.map((i) => i.value)).toContain("--append");
	});

	it("hands a path token back so file completion still works", async () => {
		const { current, calls } = makeCurrent();
		await provider(current).getSuggestions(["/save-msg ou"], 0, 12, options);
		expect(calls).toEqual(["getSuggestions"]);
	});

	it("inserts the option with a trailing space", () => {
		const { current } = makeCurrent();
		const result = provider(current).applyCompletion(
			["/save-msg --w"],
			0,
			13,
			{ value: "--with-tools", label: "--with-tools" },
			"--w",
		);
		expect(result.lines).toEqual(["/save-msg --with-tools "]);
		expect(result.cursorCol).toBe(23);
	});

	it("claims the Tab gate for its own argument positions", () => {
		// Regression: the built-in gate trims the line, so `/save-msg ` reads as a
		// bare command still being typed and Tab drops the request entirely.
		const { current } = makeCurrent();
		const gated = createCommandArgumentProvider(
			{ ...current, shouldTriggerFileCompletion: () => false },
			{ command: "save-msg", complete },
		);
		expect(gated.shouldTriggerFileCompletion?.(["/save-msg "], 0, 10)).toBe(true);
		expect(gated.shouldTriggerFileCompletion?.(["/save-msg"], 0, 9)).toBe(false);
	});

	it("delegates an item it did not offer", () => {
		const { current, calls } = makeCurrent();
		provider(current).applyCompletion(["/save-msg ou"], 0, 12, { value: "out.md", label: "out.md" }, "ou");
		expect(calls).toEqual(["applyCompletion"]);
	});
});
