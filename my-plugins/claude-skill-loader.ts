/**
 * Claude Skill Loader Extension
 *
 * Loads Claude Code plugin skills into pi with plugin-namespaced names.
 *
 * Skill names are prefixed with the plugin short name so they don't collide:
 *   office-skills/xlsx  →  /skill:office-skills-xlsx
 *   ralph-loop/help     →  /skill:ralph-loop-help
 *   ralph-loop/ralph-loop → /skill:ralph-loop-ralph-loop
 *
 * Supports two source formats:
 * 1. SKILL.md format: `<dir>/SKILL.md` with `name` + `description` frontmatter
 * 2. Command format:  `commands/<name>.md` with `description` frontmatter
 *    (skips entries marked `hide-from-slash-command-tool: "true"`)
 *
 * All skills are written as adapted SKILL.md files into a cache directory so
 * the prefixed name is properly reflected in pi's skill registry.
 *
 * Discovery sources:
 *   1. `~/.claude/plugins/installed_plugins.json` — installed plugins (prefixed)
 *   2. `~/.claude/commands/` — user's global commands (no prefix, no hidden filter)
 *      Supports files without frontmatter; description is extracted from first
 *      non-heading line of content.
 *
 * Usage:
 *   Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 *   Then use /skill:<plugin>-<name> (plugin skills) or /skill:<name> (user commands).
 *
 * Optional env vars:
 *   CLAUDE_SKILL_LOADER_EXCLUDE — comma-separated prefixed names to exclude
 *     e.g. CLAUDE_SKILL_LOADER_EXCLUDE=ralph-loop-help,ralph-loop-ralph-loop
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CLAUDE_DIR = join(homedir(), ".claude");
const PLUGINS_JSON = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
const USER_COMMANDS_DIR = join(CLAUDE_DIR, "commands");
const CACHE_DIR = join(homedir(), ".pi", "agent", "claude-skill-loader-cache");

interface PluginInstall {
	scope: string;
	installPath: string;
	version: string;
}

interface PluginsManifest {
	version: number;
	plugins: Record<string, PluginInstall[]>;
}

interface LoadedSkill {
	/** Prefixed skill name as registered in pi, e.g. "office-skills-xlsx" */
	name: string;
	/** Original unprefixed name, e.g. "xlsx" */
	originalName: string;
	description: string;
	path: string;
	source: "skill-md" | "command-adapted";
	/** Short plugin name, e.g. "office-skills" */
	plugin: string;
}

/** Extract short plugin name from a plugin key like "ralph-loop@claude-plugins-official". */
function pluginShortName(pluginKey: string): string {
	return pluginKey.split("@")[0] ?? pluginKey;
}

/**
 * Build the prefixed skill name: `<plugin>-<skillName>`.
 * Avoids double-prefix if the skill name already starts with the plugin prefix.
 */
function prefixedName(plugin: string, skillName: string): string {
	if (skillName.startsWith(`${plugin}-`) || skillName === plugin) return skillName;
	return `${plugin}-${skillName}`;
}

/**
 * Write an adapted SKILL.md file to the cache directory.
 * Returns the path to the written file, or null on failure.
 */
function writeAdaptedSkill(name: string, description: string, body: string): string | null {
	const cacheSkillDir = join(CACHE_DIR, name);
	const cacheSkillPath = join(cacheSkillDir, "SKILL.md");
	// Always quote description to handle special YAML characters
	const quotedDesc = `"${description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	const content = `---\nname: ${name}\ndescription: ${quotedDesc}\n---\n\n${body}\n`;
	try {
		mkdirSync(cacheSkillDir, { recursive: true });
		writeFileSync(cacheSkillPath, content, "utf-8");
		return cacheSkillPath;
	} catch {
		return null;
	}
}

/**
 * Extract a description from file body content (for files without frontmatter).
 * Returns the first non-empty, non-heading, non-separator line (≤ 200 chars).
 */
function extractDescriptionFromContent(body: string): string | null {
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("#") || trimmed.startsWith("---") || trimmed.startsWith("```")) continue;
		return trimmed.slice(0, 200);
	}
	return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Frontmatter parsing (minimal, no external deps)
// ────────────────────────────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const result: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();
		// Strip surrounding quotes
		const value = rawValue.replace(/^["']|["']$/g, "");
		if (key) result[key] = value;
	}
	return result;
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

/** Check if a name is valid per pi's skill naming rules. */
function isValidSkillName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= 64 &&
		/^[a-z0-9-]+$/.test(name) &&
		!name.startsWith("-") &&
		!name.endsWith("-") &&
		!name.includes("--")
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Discovery
// ────────────────────────────────────────────────────────────────────────────

/** Recursively find all SKILL.md files under a directory. */
function findSkillMdFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;
	const scan = (d: string) => {
		let entries;
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const full = join(d, entry.name);
			if (entry.isDirectory()) {
				scan(full);
			} else if (entry.isFile() && entry.name === "SKILL.md") {
				results.push(full);
			}
		}
	};
	scan(dir);
	return results;
}

/**
 * Load SKILL.md files from a plugin directory, prefixed with the plugin name.
 * Writes adapted cache files so the prefixed name is registered in pi.
 */
function loadPluginSkillMd(installPath: string, pluginKey: string, exclude: Set<string>): LoadedSkill[] {
	const skillFiles = findSkillMdFiles(installPath);
	const results: LoadedSkill[] = [];
	const plugin = pluginShortName(pluginKey);

	for (const filePath of skillFiles) {
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const fm = parseFrontmatter(content);
		const parentDirName = basename(dirname(filePath));
		const originalName = fm.name || parentDirName;
		if (!fm.description || !isValidSkillName(originalName)) continue;

		const name = prefixedName(plugin, originalName);
		if (!isValidSkillName(name) || exclude.has(name)) continue;

		const body = stripFrontmatter(content).trim();
		const path = writeAdaptedSkill(name, fm.description, body);
		if (!path) continue;

		results.push({ name, originalName, description: fm.description, path, source: "skill-md", plugin });
	}

	return results;
}

/**
 * Adapt Claude command .md files from a `commands/` directory, prefixed with plugin name.
 * Skips entries marked `hide-from-slash-command-tool: "true"`.
 */
function adaptCommandSkills(commandsDir: string, pluginKey: string, exclude: Set<string>): LoadedSkill[] {
	if (!existsSync(commandsDir)) return [];
	const results: LoadedSkill[] = [];
	const plugin = pluginShortName(pluginKey);

	let entries;
	try {
		entries = readdirSync(commandsDir, { withFileTypes: true });
	} catch {
		return results;
	}

	for (const entry of entries) {
		if (!entry.isFile() || extname(entry.name) !== ".md") continue;

		const originalName = basename(entry.name, ".md");
		if (!isValidSkillName(originalName)) continue;

		const name = prefixedName(plugin, originalName);
		if (!isValidSkillName(name) || exclude.has(name)) continue;

		const filePath = join(commandsDir, entry.name);
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const fm = parseFrontmatter(content);
		if (!fm.description) continue;
		if (fm["hide-from-slash-command-tool"] === "true") continue;

		const body = stripFrontmatter(content).trim();
		const path = writeAdaptedSkill(name, fm.description, body);
		if (!path) continue;

		results.push({ name, originalName, description: fm.description, path, source: "command-adapted", plugin });
	}

	return results;
}

/**
 * Load user's global commands from `~/.claude/commands/`.
 * No prefix applied — these are the user's own named commands.
 * Supports files with or without frontmatter; description is inferred from
 * content when frontmatter `description` is absent.
 */
function loadUserCommands(exclude: Set<string>): LoadedSkill[] {
	if (!existsSync(USER_COMMANDS_DIR)) return [];
	const results: LoadedSkill[] = [];

	let entries;
	try {
		entries = readdirSync(USER_COMMANDS_DIR, { withFileTypes: true });
	} catch {
		return results;
	}

	for (const entry of entries) {
		if (!entry.isFile() || extname(entry.name) !== ".md") continue;

		const name = basename(entry.name, ".md");
		if (!isValidSkillName(name) || exclude.has(name)) continue;

		const filePath = join(USER_COMMANDS_DIR, entry.name);
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const fm = parseFrontmatter(content);
		if (fm["hide-from-slash-command-tool"] === "true") continue;

		const body = stripFrontmatter(content).trim();
		// Prefer frontmatter description; fall back to first meaningful line of body
		const description = fm.description || extractDescriptionFromContent(body);
		if (!description) continue;

		// For no-frontmatter files the full original content is the body
		const skillBody = fm.description ? body : content.trim();
		const path = writeAdaptedSkill(name, description, skillBody);
		if (!path) continue;

		results.push({ name, originalName: name, description, path, source: "command-adapted", plugin: "user" });
	}

	return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Extension entry point
// ────────────────────────────────────────────────────────────────────────────

export default function claudeSkillLoader(pi: ExtensionAPI) {
	const excludeEnv = process.env.CLAUDE_SKILL_LOADER_EXCLUDE ?? "";
	const exclude = new Set(
		excludeEnv
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);

	// Collect loaded skills for the status command
	let loadedSkills: LoadedSkill[] = [];

	pi.on("resources_discover", () => {
		const skills: LoadedSkill[] = [];
		const seenNames = new Set<string>();

		// ── Source 1: installed plugins ──────────────────────────────────────
		if (existsSync(PLUGINS_JSON)) {
			let manifest: PluginsManifest | undefined;
			try {
				manifest = JSON.parse(readFileSync(PLUGINS_JSON, "utf-8")) as PluginsManifest;
			} catch {
				/* ignore */
			}

			if (manifest) {
				for (const [pluginKey, installations] of Object.entries(manifest.plugins)) {
					for (const install of installations) {
						const { installPath } = install;

						for (const skill of loadPluginSkillMd(installPath, pluginKey, exclude)) {
							if (!seenNames.has(skill.name)) {
								seenNames.add(skill.name);
								skills.push(skill);
							}
						}

						const commandsDir = join(installPath, "commands");
						for (const skill of adaptCommandSkills(commandsDir, pluginKey, exclude)) {
							if (!seenNames.has(skill.name)) {
								seenNames.add(skill.name);
								skills.push(skill);
							}
						}
					}
				}
			}
		}

		// ── Source 2: user's global commands (~/.claude/commands/) ───────────
		for (const skill of loadUserCommands(exclude)) {
			if (!seenNames.has(skill.name)) {
				seenNames.add(skill.name);
				skills.push(skill);
			}
		}

		loadedSkills = skills;
		return { skillPaths: skills.map((s) => s.path) };
	});

	// /claude-skills — show loaded skill status
	pi.registerCommand("claude-skills", {
		description: "List Claude plugin skills loaded by claude-skill-loader",
		handler: async (_args, ctx) => {
			if (loadedSkills.length === 0) {
				ctx.ui.notify("No Claude skills loaded. Is ~/.claude/plugins/installed_plugins.json present?", "info");
				return;
			}

			const items = loadedSkills.map((s) => {
				const tag = s.source === "command-adapted" ? " [cmd]" : "";
				return `/skill:${s.name}${tag} — ${s.description.slice(0, 55)}`;
			});

			await ctx.ui.select(`Claude Skills (${loadedSkills.length} loaded)`, items);
		},
	});
}
