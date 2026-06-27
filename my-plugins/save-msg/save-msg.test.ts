import { describe, it, expect } from "vitest";
import { extractTurnText, serializeTurns, type Turn } from "./turns.js";
import { clampScrollOffset } from "./viewport.js";
import { parseArgs } from "./parse-args.js";

// Pins F-SPEC-3/4 (hoare-audit Round2): parseArgs must error — not silently
// swallow — on an unknown dash-option (typo'd flag) and on multiple bare paths.
// The spec's "--" prefix exists so paths never collide; a dash token is a flag.
describe("parseArgs error channel (F-SPEC-3/4)", () => {
	it("parses known options and a single path", () => {
		const r = parseArgs("--with-tools --raw out.json");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.options.withTools).toBe(true);
			expect(r.options.raw).toBe(true);
			expect(r.options.path).toBe("out.json");
		}
	});

	it("errors on an unknown dash-option instead of treating it as a path", () => {
		const r = parseArgs("--raw --typo");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("--typo");
	});

	it("errors on a short unknown dash-option", () => {
		const r = parseArgs("-x out.md");
		expect(r.ok).toBe(false);
	});

	it("errors on multiple bare paths instead of silent last-wins", () => {
		const r = parseArgs("first.md second.md");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("first.md");
			expect(r.error).toContain("second.md");
		}
	});

	it("accepts --help alone", () => {
		const r = parseArgs("--help");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.options.help).toBe(true);
	});

	it("accepts -h alone", () => {
		const r = parseArgs("-h");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.options.help).toBe(true);
	});

	it("treats empty input as no options, no path", () => {
		const r = parseArgs("");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.options.path).toBeUndefined();
	});
});

// Pins Crash Issue 4 (hoare-audit Round1): toolCall.arguments is Record<string,any>
// in pi (packages/ai/src/types.ts:279), NOT a string. truncate() must not call
// .slice on an object. Regressing reverts `truncate(block.arguments || "", 100)`.
describe("extractTurnText with --with-tools (Crash Issue 4)", () => {
	function assistantTurnWithToolCall(args: unknown): Turn {
		return {
			role: "assistant",
			timestamp: "2024-01-01T00:00:00.000Z",
			preview: "calling tool",
			entries: [
				{
					type: "message",
					id: "a1",
					timestamp: "2024-01-01T00:00:00.000Z",
					message: {
						role: "assistant",
						content: [
							{ type: "text", text: "running" },
							{ type: "toolCall", name: "bash", arguments: args },
						],
					},
				},
			],
		} as unknown as Turn;
	}

	it("does not throw when arguments is an object", () => {
		const turn = assistantTurnWithToolCall({ command: "echo ok" });
		expect(() => extractTurnText(turn, true, false)).not.toThrow();
	});

	it("serializes object arguments as JSON in the tool line", () => {
		const turn = assistantTurnWithToolCall({ command: "echo ok" });
		const out = extractTurnText(turn, true, false);
		expect(out).toContain("bash(");
		expect(out).toContain("echo ok");
	});

	it("passes through string arguments unchanged", () => {
		const turn = assistantTurnWithToolCall('{"command":"ls"}');
		const out = extractTurnText(turn, true, false);
		expect(out).toContain('{"command":"ls"}');
	});

	it("handles missing arguments without throwing", () => {
		const turn = assistantTurnWithToolCall(undefined);
		expect(() => extractTurnText(turn, true, false)).not.toThrow();
	});
});

// Pins F-FUNC-2 (hoare-audit Round1, user decision: flatten): --raw must emit a
// flat Entry[] from BOTH the default path and the picker. Regressing reverts the
// picker to `map(t => t.entries)` (Entry[][]) or diverges the two call sites.
describe("serializeTurns --raw flattening (F-FUNC-2)", () => {
	function turn(role: "user" | "assistant", ...texts: string[]): Turn {
		return {
			role,
			timestamp: "2024-01-01T00:00:00.000Z",
			preview: texts[0] ?? "",
			entries: texts.map((t, i) => ({
				type: "message",
				id: `${role}-${i}`,
				timestamp: "2024-01-01T00:00:00.000Z",
				message: { role, content: t },
			})),
		} as unknown as Turn;
	}

	it("emits a flat Entry[] for a single turn", () => {
		const parsed = JSON.parse(serializeTurns([turn("assistant", "hi")], true, false, false));
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(1);
		expect(Array.isArray(parsed[0])).toBe(false);
		expect(parsed[0].message.content).toBe("hi");
	});

	it("flattens multiple turns into one Entry[] (no nesting)", () => {
		const turns = [turn("user", "q"), turn("assistant", "a1", "a2")];
		const parsed = JSON.parse(serializeTurns(turns, true, false, false));
		expect(parsed).toHaveLength(3);
		expect(parsed.every((e: unknown) => !Array.isArray(e))).toBe(true);
	});

	it("markdown mode separates turns with ---", () => {
		const turns = [turn("user", "q"), turn("assistant", "a")];
		const out = serializeTurns(turns, false, false, false);
		expect(out).toContain("\n\n---\n\n");
	});
});

// Pins F-FUNC-4 (hoare-audit Round1): after a search narrows the list, scrollOffset
// must be clamped so the visible window stays filled. The confirmed counterexample:
// 20 items, maxVisible 10, scrollOffset 10, cursor 11, narrowed to 12 items -> the
// old code left scrollOffset at 10 and rendered only 2 of 10 rows.
describe("clampScrollOffset (F-FUNC-4)", () => {
	it("clamps stale offset after the list shrinks", () => {
		expect(clampScrollOffset(10, 11, 12, 10)).toBe(2);
	});

	it("keeps cursor visible when scrolled above the window", () => {
		expect(clampScrollOffset(10, 3, 20, 10)).toBe(3);
	});

	it("scrolls down to keep cursor in view", () => {
		expect(clampScrollOffset(0, 15, 20, 10)).toBe(6);
	});

	it("returns 0 when all items fit", () => {
		expect(clampScrollOffset(5, 2, 4, 10)).toBe(0);
	});

	it("never returns a negative offset", () => {
		expect(clampScrollOffset(0, 0, 0, 10)).toBe(0);
	});

	it("never exceeds the last full page", () => {
		const offset = clampScrollOffset(99, 19, 20, 10);
		expect(offset).toBe(10);
	});
});
