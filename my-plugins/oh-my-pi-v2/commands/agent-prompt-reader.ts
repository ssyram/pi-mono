import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readAgentPrompt(agentsDir: string, agentName: string): Promise<string | undefined> {
	try {
		const content = await readFile(join(agentsDir, `${agentName}.md`), "utf-8");
		const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
		return match ? match[1].trim() : content.trim();
	} catch (error) {
		console.error(
			`[oh-my-pi commands] Failed to read agent prompt ${agentName}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}
