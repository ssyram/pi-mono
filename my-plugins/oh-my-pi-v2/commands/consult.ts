/**
 * /omp-consult — Oracle consultation for architecture and debugging advice.
 */

import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	SessionManager,
	createAgentSession,
} from "@mariozechner/pi-coding-agent";

import { readAgentPrompt, extractLastAssistantText } from "./utils.js";

// ─── Registration ────────────────────────────────────────────────────────────

export function registerConsult(
	pi: ExtensionAPI,
	agentsDir: string,
): void {
	pi.registerCommand("omp-consult", {
		description: "Consult the Oracle for architecture and debugging advice",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				await handleConsult(pi, agentsDir, args.trim(), ctx);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`omp-consult error: ${message}`, "error");
			}
		},
	});
}

async function handleConsult(
	pi: ExtensionAPI,
	agentsDir: string,
	question: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!question) {
		ctx.ui.notify("Usage: /omp-consult <your question>", "warning");
		return;
	}

	const oraclePrompt = await readAgentPrompt(agentsDir, "oracle");
	if (!oraclePrompt) {
		ctx.ui.notify("Oracle agent not found in agent registry", "error");
		return;
	}

	ctx.ui.notify(`Consulting Oracle: ${question.slice(0, 80)}...`, "info");

	const model = ctx.model ?? undefined;
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		modelRegistry: ctx.modelRegistry,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		tools: ["read", "grep", "find", "ls"],
	});

	try {
		session.agent.state.systemPrompt = oraclePrompt;

		await session.prompt(question, { expandPromptTemplates: false });
		await session.agent.waitForIdle();

		const result = extractLastAssistantText(session.agent.state.messages);

		if (!result) {
			ctx.ui.notify("Oracle returned no response", "warning");
			return;
		}

		pi.sendUserMessage(`Oracle's analysis:\n${result}`);
	} finally {
		session.dispose();
	}
}
