/**
 * M1 registry — projects pi's own command list onto the SKILL/prompt resources
 * this plugin cares about.
 *
 * Single source of truth for both consumers (autocomplete + tool), which is what
 * keeps "what the menu offers" and "what the tool can resolve" identical.
 */

export type EntryKind = "skill" | "prompt";

export interface SkillRefEntry {
	kind: EntryKind;
	/** Bare name: no "skill:" prefix, no leading slash. */
	name: string;
	/** `${kind}:${name}` — used to disambiguate a skill and a prompt sharing a name. */
	qualifiedName: string;
	description: string;
	/** Absolute path to the resource file. Empty when pi did not report one. */
	path: string;
	/** Resource directory; relative references inside a skill resolve against it. */
	baseDir?: string;
}

/** Structural view of pi's SlashCommandInfo — kept local so the plugin does not pin an import shape. */
export interface CommandLike {
	name: string;
	description?: string;
	source: string;
	sourceInfo?: { path?: string; baseDir?: string };
}

const SKILL_PREFIX = "skill:";

/**
 * Filters pi's commands down to skills and prompts, in the order pi reported them.
 * Extension commands are dropped: they are actions, not loadable text.
 *
 * Never throws — the autocomplete path runs inside the editor's render loop.
 */
export function listEntries(getCommands: () => CommandLike[]): SkillRefEntry[] {
	let commands: CommandLike[];
	try {
		commands = getCommands() ?? [];
	} catch {
		return [];
	}

	const entries: SkillRefEntry[] = [];
	for (const command of commands) {
		const kind: EntryKind | undefined =
			command?.source === "skill" ? "skill" : command?.source === "prompt" ? "prompt" : undefined;
		if (!kind) continue;

		const rawName = typeof command.name === "string" ? command.name : "";
		const name = kind === "skill" && rawName.startsWith(SKILL_PREFIX) ? rawName.slice(SKILL_PREFIX.length) : rawName;
		if (!name) continue;

		entries.push({
			kind,
			name,
			qualifiedName: `${kind}:${name}`,
			description: typeof command.description === "string" ? command.description : "",
			path: command.sourceInfo?.path ?? "",
			baseDir: command.sourceInfo?.baseDir,
		});
	}

	return entries;
}
