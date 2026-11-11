/**
 * Live Claude Code subscription usage via `claude -p "/usage"` — a local
 * intercept in the Claude Code CLI: no model call, no quota use. The child
 * process inherits this process's environment, so it reaches Anthropic
 * through whatever proxy the environment provides.
 */
import { spawn } from "node:child_process";
import type { QueryResult } from "./usage-contract.js";

export interface ClaudeUsageWindow {
	label: string;
	percent: number;
	resetsText?: string | undefined;
}

const WINDOW_LINE =
	/^(Current session|Current week(?: \([^)]+\))?): (\d+)% used(?: · resets (.+))?$/;

/** Parse the `/usage` panel text, collecting the window lines and ignoring
 * any other sections (e.g. "What's contributing to your usage?"). Returns
 * undefined when no window line is present (not logged in, or a CC build
 * without the intercept). */
export function parseClaudeUsageOutput(text: string): ClaudeUsageWindow[] | undefined {
	const windows: ClaudeUsageWindow[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const match = WINDOW_LINE.exec(rawLine.trim());
		if (!match) continue;
		const scope = match[1] ?? "";
		const label =
			scope === "Current session"
				? "5h"
				: scope === "Current week" || scope === "Current week (all models)"
					? "7d"
					: scope.slice("Current week (".length, -1);
		windows.push({ label, percent: Number(match[2]), resetsText: match[3] });
	}
	return windows.length > 0 ? windows : undefined;
}

export function formatClaudeUsageWindows(windows: ClaudeUsageWindow[]): { text: string; compact: string } {
	const primary = windows.filter((window) => window.label === "5h" || window.label === "7d");
	const parts = (primary.length > 0 ? primary : windows).map((window) =>
		`${window.percent}%(${window.label}) used${window.resetsText ? `, resets ${window.resetsText}` : ""}`,
	);
	return {
		text: parts.join(", "),
		compact: (primary.length > 0 ? primary : windows).map((window) => `${window.percent}%(${window.label})`).join(" "),
	};
}

function runUsagePanel(command: string, timeoutMs: number, signal: AbortSignal | undefined): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, ["-p", "/usage"], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});
		let stdout = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`claude -p /usage timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		timer.unref();
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else reject(new Error(`claude -p /usage exited with code ${code}`));
		});
	});
}

/** Query live subscription windows. Returns undefined when unavailable so the
 * caller can fall back to session diagnostics. */
export async function queryClaudeCodeLive(signal: AbortSignal | undefined): Promise<QueryResult | undefined> {
	const command = process.env.PI_CLAUDE_CODE_COMMAND?.trim() || "claude";
	try {
		const stdout = await runUsagePanel(command, 15_000, signal);
		const windows = parseClaudeUsageOutput(stdout);
		if (!windows || windows.length === 0) return undefined;
		const formatted = formatClaudeUsageWindows(windows);
		return { kind: "available", text: formatted.text, compact: formatted.compact };
	} catch {
		return undefined;
	}
}
