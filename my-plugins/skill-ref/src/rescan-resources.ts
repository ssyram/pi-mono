/**
 * Disk view of the resource list, produced by pi's own DefaultResourceLoader in a
 * throwaway instance, so discovery, dedupe and precedence stay pi's code.
 *
 * Fresh instance per call: a loader that has already reloaded clears the
 * process-wide extension cache on its next reload, and that must never reach the
 * live one. Only skills and prompts are wanted, so extensions, themes and context
 * files are skipped. Package output is captured so that installing a package the
 * user just added to settings — which /reload would do too — stays quiet.
 *
 * Two kinds of resource only pi can see: paths handed to it on its command line,
 * and skills bundled inside a loaded extension's directory. Those are pinned from
 * pi's own list rather than rescanned. Anything else pi might hide from a
 * extension-less loader is caught by the store's calibration, which then keeps
 * serving pi's list untouched.
 */

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { type CommandLike, listEntries, type SkillRefEntry } from "./registry.js";

export interface RescanContext {
	cwd: string;
	agentDir: string;
	/** Resources only pi can see; pinned from its list and winning name collisions. */
	pinnedCommands: () => CommandLike[];
}

/** Structural views of pi's Skill / PromptTemplate, so no import shape is pinned. */
interface ScannedSkill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
}

interface ScannedPrompt {
	name: string;
	description: string;
	filePath: string;
}

/** True for provenance an extension-less loader cannot reproduce. */
export function isPinnedSource(source: string): boolean {
	return source === "cli" || source.startsWith("extension");
}

function skillCommand(skill: ScannedSkill): CommandLike {
	return {
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill",
		sourceInfo: { path: skill.filePath, baseDir: skill.baseDir },
	};
}

function promptCommand(prompt: ScannedPrompt): CommandLike {
	return {
		name: prompt.name,
		description: prompt.description,
		source: "prompt",
		sourceInfo: { path: prompt.filePath },
	};
}

function mergeEntries(pinned: SkillRefEntry[], scanned: SkillRefEntry[]): SkillRefEntry[] {
	const pinnedNames = new Set(pinned.map((entry) => entry.qualifiedName));
	return [...pinned, ...scanned.filter((entry) => !pinnedNames.has(entry.qualifiedName))];
}

/** Re-runs pi's resource discovery and projects it through the same registry as the live list. */
export async function rescanResources(context: RescanContext): Promise<SkillRefEntry[]> {
	const loader = new DefaultResourceLoader({
		cwd: context.cwd,
		agentDir: context.agentDir,
		noExtensions: true,
		noThemes: true,
		noContextFiles: true,
		packageCommandOutput: "capture",
	});
	await loader.reload();
	const { skills } = loader.getSkills();
	const { prompts } = loader.getPrompts();
	const scanned = listEntries(() => [...prompts.map(promptCommand), ...skills.map(skillCommand)]);
	return mergeEntries(listEntries(context.pinnedCommands), scanned);
}
