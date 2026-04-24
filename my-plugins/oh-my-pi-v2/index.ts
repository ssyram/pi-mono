/**
 * oh-my-pi v2 — Thin Sisyphus runtime.
 *
 * Agents are defined as .md files (consumed by pi-subagents).
 * Delegation is handled by the external pi-subagents extension.
 * This extension only provides: prompt injection, hooks, task management, and commands.
 */

import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Config
import { loadConfig } from "./config.js";

// Tools
import { registerTaskTool } from "./tools/task.js";
import { isUnblocked, statusTag, formatTaskContent } from "./tools/task-helpers.js";

// Hooks
import { registerBoulder } from "./hooks/boulder.js";
import { registerSisyphusPrompt } from "./hooks/sisyphus-prompt.js";
import { registerKeywordDetector } from "./hooks/keyword-detector.js";
import { registerCommentChecker } from "./hooks/comment-checker.js";
import { registerContextRecovery } from "./hooks/context-recovery.js";
import { registerRulesInjector } from "./hooks/rules-injector.js";
import { registerEditErrorRecovery } from "./hooks/edit-error-recovery.js";
import { registerToolOutputTruncator } from "./hooks/tool-output-truncator.js";
import { registerCustomCompaction } from "./hooks/custom-compaction.js";

// Commands
import { registerStartWork } from "./commands/start-work.js";
import { registerConsult } from "./commands/consult.js";
import { registerReviewPlan } from "./commands/review-plan.js";
import { ensureSubagentLinks } from "./subagent-links.js";

// ─── Entry point ─────────────────────────────────────────────────────────────

export default async function ohMyPiV2(pi: ExtensionAPI) {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const agentsDir = resolve(__dirname, "agents");
	await ensureSubagentLinks(agentsDir);
	// 1. Load config (fallback to defaults on malformed config)
	let config: Awaited<ReturnType<typeof loadConfig>>;
	try {
		config = await loadConfig(process.cwd());
	} catch (err) {
		console.error(`[oh-my-pi] Failed to load config, using defaults: ${err instanceof Error ? err.message : err}`);
		config = {};
	}

	// 2. Register task tool
	const { getTaskState, setOnTaskChange } = registerTaskTool(pi);

	// 2b. Wire task changes to TUI widget
	let latestCtx: ExtensionContext | undefined;
	setOnTaskChange((tasks) => {
		try {
			if (!latestCtx) return;
			if (tasks.length === 0) {
			latestCtx.ui.setWidget("omp-tasks", undefined);
			return;
		}
		const hasActive = tasks.some(
			(t) => t.status === "in_progress" || (t.status === "pending" && isUnblocked(t, tasks)),
		);
		if (!hasActive) {
			const done = tasks.filter((t) => t.status === "done").length;
			const expired = tasks.filter((t) => t.status === "expired").length;
			const blocked = tasks.filter((t) => t.status === "pending").length;
			const parts = [];
			if (done > 0) parts.push(`✓ ${done} done`);
			if (expired > 0) parts.push(`✗ ${expired} expired`);
			if (blocked > 0) parts.push(`○ ${blocked} blocked`);
			latestCtx.ui.notify(`Tasks complete: ${parts.join(", ")}`, "info");
			latestCtx.ui.setWidget("omp-tasks", undefined);
			return;
		}
		const priorityOrder = { in_progress: 0, pending: 1, done: 3, expired: 4 };
		const sorted = [...tasks].sort((a, b) => {
			const aBlocked = a.status === "pending" && !isUnblocked(a, tasks);
			const bBlocked = b.status === "pending" && !isUnblocked(b, tasks);
			const aPri = a.status === "pending" ? (aBlocked ? 2 : 1) : (priorityOrder[a.status] ?? 5);
			const bPri = b.status === "pending" ? (bBlocked ? 2 : 1) : (priorityOrder[b.status] ?? 5);
			return aPri - bPri || a.id - b.id;
		});
		const display = sorted.slice(0, 10);
		const active = tasks.filter((t) => t.status === "in_progress" || (t.status === "pending" && isUnblocked(t, tasks))).length;
		const done = tasks.filter((t) => t.status === "done").length;
		const lines = [`Tasks (${active} active, ${done}/${tasks.length} done)`];
		for (const t of display) {
			const tag = statusTag(t, tasks);
			const icon =
				t.status === "done"
					? "✓"
					: t.status === "expired"
						? "✗"
						: t.status === "in_progress"
							? "➤"
							: tag === "[blocked]"
								? "○"
								: "⚡";
			const deps =
				tag === "[blocked]"
					? ` ← ${t.blockedBy
							.filter((bid) => {
								const d = tasks.find((x) => x.id === bid);
								return d && d.status !== "done" && d.status !== "expired";
							})
							.map((b) => `#${b}`)
							.join(",")}`
					: "";
			lines.push(`  ${icon} #${t.id} ${formatTaskContent(t)}${deps}`);
		}
		if (sorted.length > 10) lines.push(`  ... ${sorted.length - 10} more`);
		latestCtx.ui.setWidget("omp-tasks", lines);
		} catch (err) {
			console.error(`[oh-my-pi task] Widget update failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	// 3. Register hooks
	if (config.boulder_enabled !== false) {
		registerBoulder(
			pi,
			getTaskState,
		);
	}
	registerSisyphusPrompt(pi, config, agentsDir);
	registerKeywordDetector(pi);
	registerCommentChecker(pi);
	registerContextRecovery(pi, getTaskState);
	registerCustomCompaction(pi, getTaskState);
	registerRulesInjector(pi, config);
	registerEditErrorRecovery(pi);
	registerToolOutputTruncator(pi);
	// 4. Register commands
	registerStartWork(pi, agentsDir);
	registerConsult(pi, agentsDir);
	registerReviewPlan(pi, agentsDir);

	// 4c. Capture context for task widget updates
	pi.on("before_agent_start", async (_event, ctx) => {
		latestCtx = ctx;
	});

	// 5. Register skill paths
	pi.on("resources_discover", () => ({
		skillPaths: [resolve(__dirname, "skills")],
	}));

	// 6. Optional: AST-Grep tool
	try {
		let astGrepCmd = "";
		try {
			execSync("sg --version", { stdio: "ignore", timeout: 2000 });
			astGrepCmd = "sg";
		} catch (err) {
			console.error(`[oh-my-pi ast-grep] sg binary unavailable: ${err instanceof Error ? err.message : String(err)}`);
			try {
				execSync("npx @ast-grep/cli --version", { stdio: "ignore", timeout: 2000 });
				astGrepCmd = "npx @ast-grep/cli";
			} catch (err) {
				console.error(`[oh-my-pi ast-grep] npx @ast-grep/cli unavailable: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (astGrepCmd) {
			const cmd = astGrepCmd;
			pi.registerTool({
				name: "ast_grep",
				label: "AST Grep",
				description: "AST-aware code search using ast-grep. Finds patterns by structure, not just text.",
				parameters: Type.Object({
					pattern: Type.String({ description: "The AST pattern to search for" }),
					lang: Type.Optional(Type.String({ description: "Language (ts, js, py, etc.)" })),
					path: Type.Optional(Type.String({ description: "Path to search in (default: current dir)" })),
				}),
				async execute(_toolCallId, params) {
					const args = ["-p", params.pattern];
					if (params.lang) args.push("-l", params.lang);
					args.push(params.path ?? ".");
					try {
						const result = execSync(`${cmd} run ${args.map((a) => `'${a}'`).join(" ")}`, {
							encoding: "utf-8",
							timeout: 30000,
							cwd: process.cwd(),
						});
						return { content: [{ type: "text", text: result || "No matches found." }], details: undefined };
					} catch (e: unknown) {
						const execErr = e as { status?: number; stdout?: string; stderr?: string };
						// ast-grep returns exit code 1 for "no matches" — not an error
						if (execErr.status === 1) {
							return { content: [{ type: "text", text: execErr.stdout || "No matches found." }], details: undefined };
						}
						const msg = execErr.stderr || (e instanceof Error ? e.message : String(e));
						return { content: [{ type: "text", text: `ast-grep error: ${msg}` }], details: undefined };
					}
				},
			});
		}
	} catch (err) {
		console.error(`[oh-my-pi ast-grep] Tool registration failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 7. Clean up on session shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			ctx.ui.setWidget("omp-tasks", undefined);
		} catch (err) {
			console.error(`[oh-my-pi task] Widget shutdown cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		latestCtx = undefined;
	});
}
