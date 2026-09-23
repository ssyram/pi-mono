import assert from "node:assert/strict";
import test from "node:test";
import { createUsageFooter, type FooterData, type FooterSource, type FooterTui } from "../src/footer-component.js";
import { formatDisplayState } from "../src/footer-display.js";
import type { FooterTheme } from "../src/footer-stats.js";
import { collectSessionTotals } from "../src/footer-usage.js";
import type { DisplayState, Selection } from "../src/usage-contract.js";
import { makeModel } from "./test-model.js";

function usage(input: number, output: number, cacheRead: number, cacheWrite: number, total: number): object {
	return { input, output, cacheRead, cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total } };
}

test("collects the same usage entry categories as the native footer", () => {
	const totals = collectSessionTotals([
		{ type: "usage", usage: usage(1, 2, 3, 4, 0.1) },
		{ type: "message", message: { role: "assistant", usage: usage(10, 20, 30, 40, 0.2) } },
		{ type: "message", message: { role: "toolResult", usage: usage(100, 200, 300, 400, 0.3) } },
		{ type: "branch_summary", usage: usage(1000, 2000, 3000, 4000, 0.4) },
		{ type: "compaction", usage: usage(10000, 20000, 30000, 40000, 0.5) },
	]);
	assert.deepEqual(totals, {
		input: 11111,
		output: 22222,
		cacheRead: 33333,
		cacheWrite: 44444,
		cost: 1.5,
		latestCacheHitRate: 37.5,
	});
});

test("renders pure-plugin footer statistics, statuses, and cleanup without an auto indicator", () => {
	const model = makeModel({ provider: "named-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", reasoning: true });
	const selection: Selection = {
		sessionId: "session-1",
		model,
		modelId: model.id,
		providerId: model.provider,
		api: model.api,
		endpoint: model.baseUrl,
	};
	const display: DisplayState = { kind: "ready", selection, result: { kind: "available", text: "已用 34%(week)", compact: "34%(week)" } };
	assert.equal(formatDisplayState({ kind: "loading", selection }), "(…)");
	assert.equal(formatDisplayState({ kind: "ready", selection, result: { kind: "unsupported" } }), "(N/S)");
	assert.equal(formatDisplayState(display), "(34%(week))");
	const theme: FooterTheme = { fg: (_color, text) => text, bold: (text) => text };
	let renders = 0;
	let branchListener: (() => void) | undefined;
	let unsubscribed = 0;
	const tui: FooterTui = { requestRender: () => (renders += 1) };
	const footerData: FooterData = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map([["z", "second"], ["a", "first\nstate"]]),
		getAvailableProviderCount: () => 2,
		onBranchChange: (listener) => {
			branchListener = listener;
			return () => (unsubscribed += 1);
		},
	};
	const source: FooterSource = {
		sessionManager: {
			getEntries: () => [{ type: "message", message: { role: "assistant", usage: usage(1000, 20, 500, 0, 0) } }],
			getCwd: () => "/home/footer/project",
			getSessionName: () => "session-name",
		},
		modelRegistry: {
			getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
			isUsingOAuth: () => true,
		},
		getContextUsage: () => ({ contextWindow: 128000, percent: 72 }),
		getFooterSnapshot: () => ({ model, thinkingLevel: "high", display }),
	};
	const originalHome = process.env.HOME;
	process.env.HOME = "/home/footer";
	try {
		const footer = createUsageFooter(tui, theme, footerData, source);
		const lines = footer.render(180);
		assert.match(lines[0] ?? "", /^~\/project \(main\) • session-name$/);
		assert.match(lines[1] ?? "", /\$0\.000 \(34%\(week\)\) 72\.0%\/128k/);
		assert.match(lines[1] ?? "", /\(named-codex\) test-model • high$/);
		assert.doesNotMatch(lines[1] ?? "", /\(auto\)/);
		assert.equal(lines[2], "first state second");
		if (!branchListener) throw new Error("branch listener should be installed");
		branchListener();
		assert.equal(renders, 1);
		footer.dispose();
		footer.dispose();
		assert.equal(unsubscribed, 1);
		assert.deepEqual(footer.render(180), []);
	} finally {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});
