import {
	createAgentSession,
	SessionManager,
	type AgentSession,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { readAgentPrompt } from "./agent-prompt-reader.js";

export async function createStartWorkAgentSession(
	context: ExtensionCommandContext,
	agentName: "prometheus" | "momus",
): Promise<AgentSession> {
	const prompt = await readAgentPrompt(context.cwd, agentName);
	const { session } = await createAgentSession({
		cwd: context.cwd,
		model: context.model,
		modelRegistry: context.modelRegistry,
		sessionManager: SessionManager.inMemory(context.cwd),
		tools: ["read", "bash"],
	});
	if (prompt) session.agent.state.systemPrompt = prompt;
	return session;
}
