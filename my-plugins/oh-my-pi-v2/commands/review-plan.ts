/**
 * /omp-review — Momus plan review for executability.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	SessionManager,
	createAgentSession,
	readOnlyTools,
} from "@mariozechner/pi-coding-agent";

import { readAgentPrompt, extractLastAssistantText } from "./utils.js";

/**
 * Extract text blocks from an AssistantMessage's content array.
 */
function assistantContentToText(content: AssistantMessage["content"]): string {
	return content
		.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/**
 * Try to extract a plan from recent session messages.
 * Looks for assistant messages containing plan-like content.
 */
function extractRecentPlan(ctx: ExtensionCommandContext): string | null {
	const branch = ctx.sessionManager.getBranch();

	// Walk backwards through session entries looking for assistant messages with plan content
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;

		const msg = entry.message;
		if (msg.role !== "assistant") continue;

		const text = assistantContentToText((msg as AssistantMessage).content);

		// Look for structured plan markers
		if (
			/PLAN_READY/i.test(text) ||
			/^## Plan\b/m.test(text) ||
			/^### Implementation Plan\b/m.test(text) ||
			/^### Task\s+\d/m.test(text) ||
			/^## Phase\s+\d/m.test(text) ||
			(/plan/i.test(text) && text.length > 200)
		) {
			return text;
		}
	}

	return null;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerReviewPlan(
	pi: ExtensionAPI,
	agentsDir: string,
): void {
	pi.registerCommand("omp-review", {
		description: "Review a plan with Momus for executability",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				await handleReview(pi, agentsDir, args.trim(), ctx);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`omp-review error: ${message}`, "error");
			}
		},
	});
}

async function handleReview(
	pi: ExtensionAPI,
	agentsDir: string,
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	// Determine plan text
	let planText: string;

	if (args) {
		planText = args;
	} else {
		const extracted = extractRecentPlan(ctx);
		if (!extracted) {
			ctx.ui.notify(
				"No plan text provided and no recent plan found in session. Usage: /omp-review <plan text>",
				"warning",
			);
			return;
		}
		planText = extracted;
		ctx.ui.notify("Using most recent plan from session history", "info");
	}

	const momusPrompt = await readAgentPrompt(agentsDir, "momus");
	if (!momusPrompt) {
		ctx.ui.notify("Momus agent not found in agent registry", "error");
		return;
	}

	ctx.ui.notify("Spawning Momus for plan review...", "info");

	const model = ctx.model ?? undefined;
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		modelRegistry: ctx.modelRegistry,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		tools: readOnlyTools,
	});

	try {
		session.agent.state.systemPrompt = momusPrompt;

		await session.prompt(`Review this plan for executability:\n${planText}`, {
			expandPromptTemplates: false,
		});
		await session.agent.waitForIdle();

		const reviewText = extractLastAssistantText(session.agent.state.messages);

		if (!reviewText) {
			ctx.ui.notify("Momus returned no response", "warning");
			return;
		}

		// Determine verdict
		const isApproved = /\[OKAY\]/i.test(reviewText);
		const isRejected = /\[REJECT\]/i.test(reviewText);

		if (isApproved) {
			ctx.ui.notify("Momus verdict: OKAY", "info");
		} else if (isRejected) {
			ctx.ui.notify("Momus verdict: REJECT — see details below", "warning");
		}

		pi.sendUserMessage(`Momus review:\n${reviewText}`);
	} finally {
		session.dispose();
	}
}
