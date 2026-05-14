import { execFile } from "node:child_process";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { collectMessages } from "../recap/collect.js";
import { loadRecapConfig } from "../recap/config.js";
import { generateRecap } from "../recap/summarize.js";

const IDLE_RECHECK_MS = 1_000;

declare global {
	var __doneNotifyInstance: DoneNotifyInstance | undefined;
}

interface DoneNotifyInstance {
	dispose(): void;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizeNotificationText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function quoteAppleScript(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function sendMacNotification(summary: string): Promise<void> {
	const message = normalizeNotificationText(summary);
	if (message.length === 0) {
		return Promise.resolve();
	}
	const script = `display notification ${quoteAppleScript(message)} with title "pi" subtitle "done_notify"`;
	return new Promise((resolve, reject) => {
		execFile("osascript", ["-e", script], (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

export default async function doneNotify(pi: ExtensionAPI) {
	globalThis.__doneNotifyInstance?.dispose();

	const config = await loadRecapConfig(process.cwd());
	if (!config.enabled) {
		globalThis.__doneNotifyInstance = undefined;
		return;
	}

	let latestCtx: ExtensionContext | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let activeAbortController: AbortController | undefined;
	let pendingRecap = false;
	let lastRecapMessageCount = 0;
	let latestRequestedSeq = 0;

	function clearIdleTimer() {
		if (!idleTimer) {
			return;
		}
		clearTimeout(idleTimer);
		idleTimer = undefined;
	}

	function dispose() {
		clearIdleTimer();
		activeAbortController?.abort();
		activeAbortController = undefined;
		if (globalThis.__doneNotifyInstance?.dispose === dispose) {
			globalThis.__doneNotifyInstance = undefined;
		}
	}

	async function runRecap(ctx: ExtensionContext, seq: number, abortController: AbortController) {
		const snapshot = collectMessages(ctx.sessionManager);
		if (snapshot.text.trim().length === 0 || snapshot.messageCount <= lastRecapMessageCount) {
			pendingRecap = false;
			return;
		}

		const summary = await generateRecap(
			snapshot.text,
			ctx.getSystemPrompt(),
			config.model,
			ctx.modelRegistry,
			abortController.signal,
		);
		if (activeAbortController === abortController) {
			activeAbortController = undefined;
		}
		if (abortController.signal.aborted || seq !== latestRequestedSeq || !summary) {
			return;
		}

		lastRecapMessageCount = snapshot.messageCount;
		pendingRecap = false;
		try {
			await sendMacNotification(summary);
		} catch (error) {
			const message = getErrorMessage(error);
			console.error(`[done_notify] ${message}`);
			if (ctx.hasUI) {
				ctx.ui.notify(`[done_notify] ${message}`, "error");
			}
		}
	}

	function startRecap(ctx: ExtensionContext) {
		activeAbortController?.abort();
		const abortController = new AbortController();
		activeAbortController = abortController;
		const seq = ++latestRequestedSeq;
		void runRecap(ctx, seq, abortController);
	}

	function scheduleIdleRecap() {
		clearIdleTimer();
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			const ctx = latestCtx;
			if (!pendingRecap || !ctx) {
				return;
			}
			if (!ctx.isIdle()) {
				scheduleIdleRecap();
				return;
			}
			startRecap(ctx);
		}, IDLE_RECHECK_MS);
		idleTimer.unref?.();
	}

	globalThis.__doneNotifyInstance = { dispose };

	pi.on("agent_start", (_event, ctx) => {
		latestCtx = ctx;
	});

	pi.on("turn_end", (_event, ctx) => {
		latestCtx = ctx;
	});

	pi.on("agent_end", (_event, ctx) => {
		latestCtx = ctx;
		pendingRecap = true;
		scheduleIdleRecap();
	});

	pi.on("session_shutdown", () => {
		dispose();
	});
}
