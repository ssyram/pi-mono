/**
 * /ultrawork command — UltraWork maximalist execution mode
 * 
 * Activates a sticky mode where Sisyphus operates with maximum rigor:
 * - Forced design phase if intent is unclear
 * - Exhaustive multi-dimensional auditing
 * - Automatic non-decisional fixes
 * - User confirmation only for decisional items
 * 
 * Usage:
 *   /ultrawork <message>     — Enable mode + send message
 *   /ultrawork off           — Disable mode
 *   /ultrawork off <message> — Keep enabled + send message
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

interface UltraWorkState {
	enabled: boolean;
	activatedAt: string;
}

const STATE_FILE = ".pi/ultrawork-state.json";

function loadState(cwd: string): UltraWorkState | null {
	const statePath = join(cwd, STATE_FILE);
	if (!existsSync(statePath)) return null;
	try {
		return JSON.parse(readFileSync(statePath, "utf-8"));
	} catch {
		return null;
	}
}

function saveState(cwd: string, state: UltraWorkState): void {
	const stateDir = join(cwd, ".pi");
	if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
	writeFileSync(join(cwd, STATE_FILE), JSON.stringify(state, null, 2));
}

function deleteState(cwd: string): void {
	const statePath = join(cwd, STATE_FILE);
	if (existsSync(statePath)) {
		try {
			require("fs").unlinkSync(statePath);
		} catch {}
	}
}

export function registerUltrawork(pi: ExtensionAPI, _agentsDir: string) {
	pi.registerCommand("ultrawork", {
		description: "Enable/disable UltraWork maximalist execution mode",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const { cwd } = ctx;
			const trimmedArgs = args.trim();

			// Parse command variants
			const isOffCommand = trimmedArgs === "off";
			const isOffWithMessage = trimmedArgs.startsWith("off ");

			if (isOffCommand) {
				// Pure off — disable mode
				deleteState(cwd);
				pi.sendUserMessage("[UltraWork mode disabled]");
				return;
			}

			// Enable mode (either with message or "off <message>")
			const state: UltraWorkState = {
				enabled: true,
				activatedAt: new Date().toISOString(),
			};
			saveState(cwd, state);

			// Extract actual message
			const userMessage = isOffWithMessage ? trimmedArgs.slice(4).trim() : trimmedArgs;

			// Inject mode activation marker + user message
			const fullMessage = userMessage
				? `[UltraWork mode enabled]\n\n${userMessage}`
				: "[UltraWork mode enabled]";

			pi.sendUserMessage(fullMessage);
		},
	});
}
