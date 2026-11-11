import assert from "node:assert/strict";
import test from "node:test";
import { formatClaudeUsageWindows, parseClaudeUsageOutput } from "../src/cc-live.js";

const PANEL = `You are currently using your subscription to power your Claude Code usage

Current session: 0% used · resets Nov 11 at 8:10pm (Asia/Hong_Kong)
Current week (all models): 0% used · resets Nov 12 at 6pm (Asia/Hong_Kong)
Current week (Fable): 3% used · resets Nov 12 at 6pm (Asia/Hong_Kong)
`;

test("parses the live /usage panel into windows", () => {
	const windows = parseClaudeUsageOutput(PANEL);
	assert.deepEqual(windows, [
		{ label: "5h", percent: 0, resetsText: "Nov 11 at 8:10pm (Asia/Hong_Kong)" },
		{ label: "7d", percent: 0, resetsText: "Nov 12 at 6pm (Asia/Hong_Kong)" },
		{ label: "Fable", percent: 3, resetsText: "Nov 12 at 6pm (Asia/Hong_Kong)" },
	]);
});

test("compact keeps 5h/7d and detail keeps upstream reset text verbatim", () => {
	const formatted = formatClaudeUsageWindows(parseClaudeUsageOutput(PANEL) ?? []);
	assert.equal(formatted.compact, "0%(5h) 0%(7d)");
	assert.match(formatted.text, /0%\(5h\) used, resets Nov 11 at 8:10pm \(Asia\/Hong_Kong\)/);
	assert.ok(!formatted.text.includes("Fable"));
});

test("returns undefined for the not-logged-in result summary", () => {
	assert.equal(parseClaudeUsageOutput("Total cost:            $0.0000\nUsage:                 0 input, 0 output\n"), undefined);
	assert.equal(parseClaudeUsageOutput("random text\n"), undefined);
});

test("ignores trailing sections such as the usage breakdown", () => {
	const windows = parseClaudeUsageOutput(
		PANEL +
			"\nWhat's contributing to your usage?\nApproximate · sessions on this machine only · shares overlap\n\nLast 24h · 2 requests · 2 sessions\n  57%  Turn off skills you don't use · 13k tokens per request\n",
	);
	assert.equal(windows?.length, 3);
});

test("falls back to all windows when neither 5h nor 7d is present", () => {
	const formatted = formatClaudeUsageWindows([{ label: "Fable", percent: 7 }]);
	assert.equal(formatted.compact, "7%(Fable)");
});
