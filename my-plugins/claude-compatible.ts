/**
 * Claude Compatible Extension
 *
 * Mimics Claude Code's CLAUDE.md behavior: reads global and project-level
 * CLAUDE.md files and injects their content into the system prompt on every
 * agent run, so instructions are always present in each LLM call.
 *
 * File discovery order (matches Claude Code):
 *   1. ~/.claude/CLAUDE.md                  — global user instructions
 *   2. Parent directories up to home/root   — ancestor project instructions
 *   3. <cwd>/CLAUDE.md                      — project root instructions
 *   4. <cwd>/.claude/CLAUDE.md              — project .claude/ instructions
 *
 * Usage:
 *   Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface ClaudeFile {
	label: string;
	absolutePath: string;
	content: string;
}

function readFileIfExists(filePath: string): string | null {
	try {
		if (fs.existsSync(filePath)) {
			return fs.readFileSync(filePath, "utf-8");
		}
	} catch {
		// ignore unreadable files
	}
	return null;
}

/**
 * Collect all CLAUDE.md files in discovery order.
 */
function discoverClaudeFiles(cwd: string): ClaudeFile[] {
	const results: ClaudeFile[] = [];
	const seen = new Set<string>();

	function addFile(absolutePath: string, label: string) {
		const resolved = path.resolve(absolutePath);
		if (seen.has(resolved)) return;
		const content = readFileIfExists(resolved);
		if (content === null) return;
		const trimmed = content.trim();
		if (trimmed.length === 0) return;
		seen.add(resolved);
		results.push({ label, absolutePath: resolved, content: trimmed });
	}

	// 1. Global CLAUDE.md
	addFile(path.join(os.homedir(), ".claude", "CLAUDE.md"), "Global (~/.claude/CLAUDE.md)");

	// 2. Ancestor CLAUDE.md files — walk from home dir down to cwd
	const home = os.homedir();
	const cwdResolved = path.resolve(cwd);
	const ancestors: string[] = [];
	let cur = cwdResolved;
	while (true) {
		const parent = path.dirname(cur);
		if (parent === cur) break; // reached filesystem root
		if (cur === home) break; // stop at home (global already included)
		ancestors.unshift(cur);
		cur = parent;
	}
	for (const dir of ancestors) {
		const candidatePath = path.join(dir, "CLAUDE.md");
		const rel = path.relative(cwdResolved, dir) || ".";
		addFile(candidatePath, `Ancestor (${rel}/CLAUDE.md)`);
	}

	// 3. Project root CLAUDE.md
	addFile(path.join(cwd, "CLAUDE.md"), `Project (CLAUDE.md)`);

	// 4. Project .claude/CLAUDE.md
	addFile(path.join(cwd, ".claude", "CLAUDE.md"), `Project (.claude/CLAUDE.md)`);

	return results;
}

export default function claudeCompatibleExtension(pi: ExtensionAPI) {
	let claudeFiles: ClaudeFile[] = [];

	// Discover files at session start so we can notify the user
	pi.on("session_start", async (_event, ctx) => {
		claudeFiles = discoverClaudeFiles(ctx.cwd);
		if (claudeFiles.length > 0) {
			const labels = claudeFiles.map((f) => f.label).join(", ");
			ctx.ui.notify(`claude-compatible: loaded ${claudeFiles.length} CLAUDE.md file(s): ${labels}`, "info");
		}
	});

	// Inject content into the system prompt before each agent run.
	// Because the system prompt is included in every LLM API call, this
	// effectively adds the instructions to every step — matching Claude Code.
	pi.on("before_agent_start", async (event, ctx) => {
		// Re-read on each agent start so edits to CLAUDE.md take effect
		claudeFiles = discoverClaudeFiles(ctx.cwd);
		if (claudeFiles.length === 0) return;

		const sections = claudeFiles
			.map((f) => `<claude_md source="${f.label}" path="${f.absolutePath}">\n${f.content}\n</claude_md>`)
			.join("\n\n");

		return {
			systemPrompt:
				event.systemPrompt +
				`\n\n# Instructions from CLAUDE.md files\n\nThe following instructions come from CLAUDE.md files in the current project hierarchy. They OVERRIDE default behavior and must be followed exactly.\n\n${sections}`,
		};
	});
}
