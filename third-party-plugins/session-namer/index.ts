/**
 * Session Namer — pi extension that auto-names chat sessions based on content.
 *
 * Triggers when session file exceeds a size threshold (default 10KB),
 * or synchronously with compaction. Generates a concise name via LLM.
 *
 * Command: /session-namer [action] [args]
 *   - (no args)         Show current config and session name
 *   - rename             Force rename now
 *   - config <key> <val> Update a config parameter
 *   - on / off           Enable / disable auto-renaming
 *
 * Syncs with recap plugin: triggers naming on the same agent_end event.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation, buildSessionContext } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---

interface NamerConfig {
	enabled: boolean;
	sizeThreshold: number;   // bytes, default 10240 (10KB)
	maxLength: number;        // bytes, default 40
	separator: string;        // default " | "
	autoRename: boolean;      // auto rename on threshold, default true
	renameOnCompact: boolean; // rename synced with recap on agent_end, default true
}

const CONFIG_FILE = "session-namer.json";
const ENTRY_TYPE = "session-namer-v1";

const DEFAULT_CONFIG: NamerConfig = {
	enabled: true,
	sizeThreshold: 10240,
	maxLength: 40,
	separator: " | ",
	autoRename: true,
	renameOnCompact: true,
};

function loadConfig(): NamerConfig {
	const paths = [
		join(__dirname, "config.default.json"),
		join(process.env.HOME || "~", ".pi/agent", CONFIG_FILE),
	];
	// Also check project-local
	if (process.cwd()) {
		paths.push(join(process.cwd(), ".pi", CONFIG_FILE));
	}
	let merged = { ...DEFAULT_CONFIG };
	for (const p of paths) {
		if (!existsSync(p)) continue;
		try {
			const raw = JSON.parse(readFileSync(p, "utf-8"));
			merged = { ...merged, ...raw };
		} catch {}
	}
	return merged;
}

function saveGlobalConfig(patch: Partial<NamerConfig>) {
	const globalPath = join(process.env.HOME || "~", ".pi/agent", CONFIG_FILE);
	let existing: Partial<NamerConfig> = {};
	if (existsSync(globalPath)) {
		try { existing = JSON.parse(readFileSync(globalPath, "utf-8")); } catch {}
	}
	writeFileSync(globalPath, JSON.stringify({ ...existing, ...patch }, null, 2), "utf-8");
}

// --- Prompt ---

function getNamerPrompt(): string {
	const cached = namerPromptCache;
	if (cached) return cached;
	const p = readFileSync(join(__dirname, "prompts", "namer.md"), "utf-8");
	namerPromptCache = p;
	return p;
}
let namerPromptCache: string | null = null;

// --- Helpers ---

function byteLength(s: string): number {
	return Buffer.byteLength(s, "utf-8");
}

function getSessionFileSize(ctx: ExtensionContext): number | null {
	const file = ctx.sessionManager.getSessionFile();
	if (!file || !existsSync(file)) return null;
	try { return statSync(file).size; } catch { return null; }
}

function extractConversationText(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getEntries();
	const { messages } = buildSessionContext(entries);
	return serializeConversation(convertToLlm(messages));
}

async function generateName(
	ctx: ExtensionContext,
	cfg: NamerConfig,
	signal?: AbortSignal,
): Promise<string | null> {
	const model = ctx.model;
	if (!model) return null;

	const auth = ctx.modelRegistry.getApiKeyAndHeaders(model);
	const convText = extractConversationText(ctx);

	// Limit input to ~8000 chars to avoid huge prompts
	const input = convText.length > 8000
		? convText.slice(0, 4000) + "\n...\n" + convText.slice(-4000)
		: convText;

	const systemPrompt = getNamerPrompt()
		.replace("{{maxLength}}", String(cfg.maxLength))
		.replace(/{{separator}}/g, cfg.separator);

	const response = await complete(model, {
		systemPrompt,
		messages: [{
			role: "user" as const,
			content: [{ type: "text" as const, text: input }],
			timestamp: Date.now(),
		}],
	}, {
		apiKey: auth.apiKey,
		headers: auth.headers,
		maxTokens: 100,
		signal,
	});

	const text = response.content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("")
		.trim();

	if (!text) return null;

	// Truncate if over max byte length
	if (byteLength(text) > cfg.maxLength) {
		let truncated = text;
		while (byteLength(truncated) > cfg.maxLength && truncated.length > 0) {
			truncated = truncated.slice(0, -1);
		}
		return truncated.trim();
	}
	return text;
}

// --- State persistence ---

interface NamerState {
	lastNamedSize: number;
	nameCount: number;
}

function persistState(pi: ExtensionAPI, state: NamerState) {
	pi.appendEntry(ENTRY_TYPE, state);
}

function restoreState(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): NamerState {
	let state: NamerState = { lastNamedSize: 0, nameCount: 0 };
	for (const entry of entries) {
		if (entry.type === "custom" && (entry as any).customType === ENTRY_TYPE) {
			const data = (entry as any).data as NamerState;
			if (data) state = data;
		}
	}
	return state;
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
	let cfg = loadConfig();
	let state: NamerState = { lastNamedSize: 0, nameCount: 0 };
	let isRenaming = false; // prevent concurrent renames

	async function doRename(ctx: ExtensionContext, reason: string, signal?: AbortSignal) {
		if (isRenaming) return;
		isRenaming = true;
		try {
			if (ctx.hasUI) ctx.ui.notify(`[session-namer] Generating name (${reason})...`, "info");

			const name = await generateName(ctx, cfg, signal);
			if (!name) {
				if (ctx.hasUI) ctx.ui.notify("[session-namer] LLM returned empty name, skipped.", "warning");
				return;
			}

			pi.setSessionName(name);
			const fileSize = getSessionFileSize(ctx) ?? 0;
			state.lastNamedSize = fileSize;
			state.nameCount++;
			persistState(pi, state);

			if (ctx.hasUI) ctx.ui.notify(`[session-namer] Session named: ${name}`, "info");
		} catch (e: any) {
			if (ctx.hasUI) ctx.ui.notify(`[session-namer] Rename failed: ${e.message}`, "error");
		} finally {
			isRenaming = false;
		}
	}

	function checkAndRename(ctx: ExtensionContext, reason: string) {
		if (!cfg.enabled || !cfg.autoRename) return;
		const fileSize = getSessionFileSize(ctx);
		if (fileSize === null) return;
		if (fileSize < cfg.sizeThreshold) return;
		if (fileSize <= state.lastNamedSize) return; // already named at this size or larger
		doRename(ctx, reason);
	}

	// Restore state on session start
	pi.on("session_start", (_event, ctx) => {
		cfg = loadConfig();
		state = restoreState(ctx.sessionManager.getEntries());
	});

	// Sync with recap: trigger on agent_end (same event recap uses)
	pi.on("agent_end", (_event, ctx) => {
		if (!cfg.enabled) return;
		if (cfg.renameOnCompact) {
			doRename(ctx, "sync with recap");
		} else if (cfg.autoRename) {
			checkAndRename(ctx, "size threshold");
		}
	});

	// Sync with compact: trigger on session_before_compact as fallback
	pi.on("session_before_compact", (_event, ctx) => {
		if (!cfg.enabled || !cfg.renameOnCompact) return;
		doRename(ctx, "sync with compact");
	});

	// /session-namer command
	pi.registerCommand("session-namer", {
		description: "Session namer: rename | on | off | config <key> <val> | status",
		async handler(args, ctx) {
			const parts = args.trim().split(/\s+/);
			const action = parts[0];

			if (!action || action === "status") {
				const currentName = pi.getSessionName();
				const fileSize = getSessionFileSize(ctx);
				ctx.ui.notify(
					`[session-namer] Status:\n` +
					`  enabled: ${cfg.enabled}\n` +
					`  autoRename: ${cfg.autoRename}\n` +
					`  renameOnCompact: ${cfg.renameOnCompact}\n` +
					`  sizeThreshold: ${cfg.sizeThreshold} bytes\n` +
					`  maxLength: ${cfg.maxLength} bytes\n` +
					`  separator: "${cfg.separator}"\n` +
					`  fileSize: ${fileSize ?? "unknown"} bytes\n` +
					`  lastNamedSize: ${state.lastNamedSize}\n` +
					`  nameCount: ${state.nameCount}\n` +
					`  currentName: ${currentName ?? "(none)"}`,
					"info",
				);
				return;
			}

			if (action === "rename") {
				await doRename(ctx, "manual");
				return;
			}

			if (action === "on") {
				cfg.enabled = true;
				cfg.autoRename = true;
				saveGlobalConfig({ enabled: true, autoRename: true });
				ctx.ui.notify("[session-namer] Enabled.", "info");
				return;
			}

			if (action === "off") {
				cfg.enabled = false;
				cfg.autoRename = false;
				saveGlobalConfig({ enabled: false, autoRename: false });
				ctx.ui.notify("[session-namer] Disabled.", "info");
				return;
			}

			if (action === "config") {
				const key = parts[1];
				const val = parts.slice(2).join(" ");
				if (!key || val === undefined) {
					ctx.ui.notify("[session-namer] Usage: /session-namer config <key> <value>", "warning");
					return;
				}
				const numKeys = new Set(["sizeThreshold", "maxLength"]);
				if (numKeys.has(key)) {
					const num = Number(val);
					if (isNaN(num) || num <= 0) {
						ctx.ui.notify(`[session-namer] ${key} must be a positive number.`, "error");
						return;
					}
					(cfg as any)[key] = num;
					saveGlobalConfig({ [key]: num });
					ctx.ui.notify(`[session-namer] ${key} = ${num}`, "info");
				} else if (key === "separator") {
					cfg.separator = val;
					saveGlobalConfig({ separator: val });
					ctx.ui.notify(`[session-namer] separator = "${val}"`, "info");
				} else if (key === "enabled" || key === "autoRename" || key === "renameOnCompact") {
					const bool = val === "true" || val === "1";
					(cfg as any)[key] = bool;
					saveGlobalConfig({ [key]: bool });
					ctx.ui.notify(`[session-namer] ${key} = ${bool}`, "info");
				} else {
					ctx.ui.notify(`[session-namer] Unknown config key: ${key}\nAvailable: sizeThreshold, maxLength, separator, enabled, autoRename, renameOnCompact`, "warning");
				}
				return;
			}

			ctx.ui.notify(
				`[session-namer] Unknown action: ${action}\n` +
				`Usage: /session-namer [status | rename | on | off | config <key> <val>]`,
				"warning",
			);
		},
	});
}
