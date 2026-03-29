/**
 * oh-my-pi — Multi-Agent Orchestration Extension for Pi.
 *
 * Ports the oh-my-openagent experience into pi's Extension framework:
 * 11 specialized agents, 8-category task routing, Boulder loop enforcement,
 * Prometheus planning, Oracle consultation, Momus review, and code rules.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Agent definitions
import type { AgentDef } from "./agents/types.js";
import { sisyphus } from "./agents/sisyphus.js";
import { oracle } from "./agents/oracle.js";
import { metis } from "./agents/metis.js";
import { momus } from "./agents/momus.js";
import { atlas } from "./agents/atlas.js";
import { explore } from "./agents/explore.js";
import { librarian } from "./agents/librarian.js";
import { multimodalLooker } from "./agents/multimodal-looker.js";
import { hephaestus } from "./agents/hephaestus.js";
import { sisyphusJunior } from "./agents/sisyphus-junior.js";
import { prometheus } from "./agents/prometheus.js";

// Config
import { loadConfig } from "./config.js";

// Tools
import { ConcurrencyManager, type Job } from "./tools/concurrency.js";
import { registerDelegateTask, disposeDelegateTaskSessions } from "./tools/delegate-task.js";
import { registerCallAgent, disposeCallAgentSessions } from "./tools/call-agent.js";
import { registerTaskTool } from "./tools/task.js";
import { isUnblocked, statusTag } from "./tools/task-helpers.js";
import { registerBackgroundTask } from "./tools/background-task.js";
import { registerBackgroundOutput } from "./tools/background-output.js";

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

// ─── All agent definitions ───────────────────────────────────────────────────

const ALL_AGENTS: AgentDef[] = [
	sisyphus,
	oracle,
	metis,
	momus,
	atlas,
	explore,
	librarian,
	multimodalLooker,
	hephaestus,
	sisyphusJunior,
	prometheus,
];

// ─── Entry point ─────────────────────────────────────────────────────────────

export default async function ohMyPi(pi: ExtensionAPI) {
	// 1. Load config
	const config = await loadConfig(process.cwd());

	// ── Stop-continuation state ──────────────────────────────────────────────
	// When true, Boulder hook will not auto-restart the agent loop.
	// Reset automatically when the user sends a new message.
	let continuationStopped = false;

	// 2. Build agent registry, filtering out disabled agents
	const disabled = new Set(config.disabled_agents ?? []);
	const agents = new Map<string, AgentDef>();
	for (const agent of ALL_AGENTS) {
		if (!disabled.has(agent.name)) {
			agents.set(agent.name, agent);
		}
	}

	// 3. Create concurrency manager.
	//    Completed/errored jobs are buffered; follow-ups are sent from the
	//    agent_end hook so that markViewed() calls during the turn can suppress
	//    notifications for jobs whose output was already consumed.
	const pendingNotifications: Job[] = [];
	const concurrency = new ConcurrencyManager({ defaultConcurrency: config.max_concurrent_tasks ?? 5 }, (job) => {
		if (job.status === "completed" || job.status === "error") {
			pendingNotifications.push(job);
		}
	});

	// 3b. Wire up TUI status bar for background job counts
	let latestCtx: ExtensionContext | undefined;
	concurrency.setOnStatusChange(({ running, queued }) => {
		if (!latestCtx) return;
		if (running === 0 && queued === 0) {
			latestCtx.ui.setStatus("omp-jobs", undefined);
		} else {
			latestCtx.ui.setStatus("omp-jobs", `\u{1F504} ${running} running \u00B7 ${queued} queued`);
		}
	});

	// 4. Register task tool (returns getTaskState for boulder & sisyphus-prompt)
	const { getTaskState, setOnTaskChange } = registerTaskTool(pi);

	// 4b. Wire task changes to TUI widget
	setOnTaskChange((tasks) => {
		if (!latestCtx) return;
		if (tasks.length === 0) {
			latestCtx.ui.setWidget("omp-tasks", undefined);
			return;
		}
		const hasActive = tasks.some((t) => t.status === "in_progress" || (t.status === "pending" && isUnblocked(t, tasks)));
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
		const active = tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length;
		const done = tasks.filter((t) => t.status === "done").length;
		const lines = [`Tasks (${active} active, ${done}/${tasks.length} done)`];
		for (const t of display) {
			const tag = statusTag(t, tasks);
			const icon = t.status === "done" ? "✓"
				: t.status === "expired" ? "✗"
				: t.status === "in_progress" ? "➤"
				: tag === "[blocked]" ? "○"
				: "⚡";
			const deps = tag === "[blocked]"
				? ` ← ${t.blockedBy.filter((bid) => { const d = tasks.find((x) => x.id === bid); return d && d.status !== "done" && d.status !== "expired"; }).map((b) => `#${b}`).join(",")}`
				: "";
			lines.push(`  ${icon} #${t.id} ${t.text}${deps}`);
		}
		if (sorted.length > 10) lines.push(`  ... ${sorted.length - 10} more`);
		latestCtx.ui.setWidget("omp-tasks", lines);
	});

	// 5. Register delegation tools
	registerDelegateTask(pi, agents, config, concurrency);
	registerCallAgent(pi, agents, config, concurrency);
	registerBackgroundTask(pi, concurrency);
	registerBackgroundOutput(pi, concurrency);

	// 6. Register hooks
	if (config.boulder_enabled !== false) {
		registerBoulder(pi, getTaskState, () => continuationStopped, () => {
			const { running, queued } = concurrency.getActiveCounts();
			return running > 0 || queued > 0;
		});
	}
	registerSisyphusPrompt(pi, agents);
	registerKeywordDetector(pi);
	registerCommentChecker(pi);
	registerContextRecovery(pi, getTaskState);
	registerCustomCompaction(pi, getTaskState, concurrency);
	registerRulesInjector(pi, config);
	registerEditErrorRecovery(pi);
	registerToolOutputTruncator(pi);

	// 7. Register commands
	registerStartWork(pi, agents);
	registerConsult(pi, agents);
	registerReviewPlan(pi, agents);

	// 7b. /omp-stop command — lets the user halt all auto-continuation
	pi.registerCommand("omp-stop", {
		description: "Stop all automatic continuation (Boulder loop enforcement) and cancel pending background tasks",
		handler: async (_args, ctx) => {
			continuationStopped = true;
			// Cancel all queued and running background tasks
			let cancelledCount = 0;
			for (const job of concurrency.list()) {
				if (job.status === "queued" || job.status === "running") {
					if (concurrency.cancel(job.id)) {
						cancelledCount++;
					}
				}
			}
			const taskMsg = cancelledCount > 0 ? ` ${cancelledCount} background task(s) cancelled.` : "";
			ctx.ui.notify(`Auto-continuation stopped.${taskMsg} Send a new message to re-enable.`, "info");
		},
	});

	// 7c. Auto-clear stop flag when the user sends a new message + capture ctx for status bar
	pi.on("before_agent_start", async (_event, ctx) => {
		latestCtx = ctx;
		if (continuationStopped) {
			continuationStopped = false;
		}
	});

	// 7c-2. Deliver pending background-task completion notifications, skipping
	//       any whose output was already consumed via background_output / background_task.
	pi.on("agent_end", async () => {
		const jobs = pendingNotifications.splice(0);
		for (const job of jobs) {
			if (concurrency.isViewed(job.id)) continue;
			if (job.status === "completed") {
				const preview = job.result?.slice(0, 500) ?? "(no output)";
				pi.sendUserMessage(
					`Background task completed: [${job.agent}] finished job ${job.id}\n\nResult preview: ${preview}`,
					{ deliverAs: "followUp" },
				);
			} else if (job.status === "error") {
				pi.sendUserMessage(
					`Background task failed: [${job.agent}] job ${job.id} errored: ${job.error}`,
					{ deliverAs: "followUp" },
				);
			}
		}
	});

	// 7d. Clean up concurrency manager and session caches on session shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		for (const job of concurrency.list()) {
			if (job.status === "queued" || job.status === "running") {
				concurrency.cancel(job.id);
			}
		}
		// Clear status bar and widget
		ctx.ui.setStatus("omp-jobs", undefined);
		ctx.ui.setWidget("omp-tasks", undefined);
		latestCtx = undefined;
		// M7: Dispose all cached sub-agent sessions
		disposeDelegateTaskSessions();
		disposeCallAgentSessions();
	});

	// 8. Register skill paths
	const __dirname = dirname(fileURLToPath(import.meta.url));
	pi.on("resources_discover", () => ({
		skillPaths: [resolve(__dirname, "skills")],
	}));

	// 9. Optional: AST-Grep tool (available only when ast-grep is installed)
	try {
		const { execSync } = await import("node:child_process");
		let astGrepCmd = "";

		// Prefer native `sg` binary (fast), fallback to npx (slower)
		try {
			execSync("sg --version", { stdio: "ignore", timeout: 2000 });
			astGrepCmd = "sg";
		} catch {
			try {
				execSync("npx @ast-grep/cli --version", { stdio: "ignore", timeout: 2000 });
				astGrepCmd = "npx @ast-grep/cli";
			} catch {
				// Neither available
			}
		}

		if (astGrepCmd) {
			const cmd = astGrepCmd;
			pi.registerTool({
				name: "ast_grep",
				label: "AST Grep",
				description:
					"AST-aware code search using ast-grep. Finds patterns by structure, not just text.",
				parameters: Type.Object({
					pattern: Type.String({ description: "The AST pattern to search for" }),
					lang: Type.Optional(Type.String({ description: "Language (ts, js, py, etc.)" })),
					path: Type.Optional(Type.String({ description: "Path to search in (default: current dir)" })),
				}),
				async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
					const { execSync: exec } = await import("node:child_process");
					const args = ["-p", params.pattern];
					if (params.lang) args.push("-l", params.lang);
					args.push(params.path ?? ".");
					const result = exec(
						`${cmd} run ${args.map((a) => `'${a}'`).join(" ")}`,
						{
							encoding: "utf-8",
							timeout: 30000,
							cwd: process.cwd(),
						},
					);
					return { content: [{ type: "text", text: result || "No matches found." }], details: undefined };
				},
			});
		}
	} catch {
		// ast-grep not available, skip silently
	}

	// 10. Process exit cleanup — cancel all active jobs on unexpected termination
	const cleanup = () => {
		for (const job of concurrency.list()) {
			if (job.status === "queued" || job.status === "running") {
				concurrency.cancel(job.id);
			}
		}
	};

	process.on("exit", cleanup);
	process.on("SIGTERM", cleanup);
	process.on("SIGINT", cleanup);
}
