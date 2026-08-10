import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createStartWorkAgentSession } from "./start-work-agent-session.js";
import {
	extractLastAssistantText,
	parseMomusFinalReview,
	parseMomusGateOneResponse,
	type MomusFinalAction,
	type MomusGateOneStatus,
} from "./start-work-parsing.js";

export async function runMomusGateOneReview(
	context: ExtensionCommandContext,
	form: string,
): Promise<{ status: MomusGateOneStatus; findings: string }> {
	const session = await createStartWorkAgentSession(context, "momus");
	try {
		await session.prompt(
			`You are in Role 1: Stage 1 Gatekeeper.\n\n` +
				`Review the following intent confirmation form and decide: APPROVED, APPROVED_WITH_WARNINGS, or REJECTED.\n\n` +
				`Form:\n\`\`\`yaml\n${form}\n\`\`\`\n\n` +
				"Provide your review in the specified YAML format.",
			{ expandPromptTemplates: false },
		);
		await session.agent.waitForIdle();
		return parseMomusGateOneResponse(extractLastAssistantText(session));
	} finally {
		session.dispose();
	}
}

export async function runMomusFinalReview(
	context: ExtensionCommandContext,
	document: string,
): Promise<{ action: MomusFinalAction; rationale: string; text: string }> {
	const session = await createStartWorkAgentSession(context, "momus");
	try {
		await session.prompt(
			`You are in Role 3: Stage 2 Final Self-Reviewer.\n\n` +
				`Prometheus has declared the design complete. Perform final self-review and recommend: END, EXPAND, or SUPPLEMENT.\n\n` +
				`Design Document:\n\`\`\`markdown\n${document}\n\`\`\`\n\n` +
				"Provide your final self-review in the specified format.",
			{ expandPromptTemplates: false },
		);
		await session.agent.waitForIdle();
		const text = extractLastAssistantText(session);
		return { ...parseMomusFinalReview(text), text };
	} finally {
		session.dispose();
	}
}

export async function runMomusCollaborativeReview(
	context: ExtensionCommandContext,
	document: string,
): Promise<string> {
	const session = await createStartWorkAgentSession(context, "momus");
	try {
		await session.prompt(
			`You are in Role 2: Stage 2 Collaborative Reviewer.\n\n` +
				`Review the following design document and extract hidden decision points from the non-decision list.\n\n` +
				`Design Document:\n\`\`\`markdown\n${document}\n\`\`\`\n\n` +
				"Append your review findings in the specified format.",
			{ expandPromptTemplates: false },
		);
		await session.agent.waitForIdle();
		return extractLastAssistantText(session);
	} finally {
		session.dispose();
	}
}
