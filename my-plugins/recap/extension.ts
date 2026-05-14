/**
 * Recap plugin — periodic + event-driven conversation recap.
 *
 * Displays timestamped status summaries above the editor input while an
 * agent run is active, then stops the cadence at agent_end.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadRecapConfig } from "./config.js";
import { collectMessages } from "./collect.js";
import { generateRecap } from "./summarize.js";

const WIDGET_KEY = "recap";
const INSTANCE_KEY = "__recap_plugin_active__";

type IntervalTimer = ReturnType<typeof setInterval>;
type TimeoutTimer = ReturnType<typeof setTimeout>;

interface StoredState {
	intervalTimer?: IntervalTimer;
	dismissTimer?: TimeoutTimer;
	abortController?: AbortController;
}

function formatRecapTime(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatRecap(summary: string, date = new Date()): string {
	return `Recap (${formatRecapTime(date)}): ${summary}`;
}

interface RecapSnapshot {
	ctx: ExtensionContext;
	text: string;
	messageCount: number;
	systemPrompt: string | undefined;
	notifyOnDismiss: boolean;
	seq: number;
	signal: AbortSignal;
}

export default async function recap(pi: ExtensionAPI): Promise<void> {
	const g = globalThis as Record<string, unknown>;
	const prev = g[INSTANCE_KEY] as StoredState | undefined;
	if (prev?.intervalTimer) clearInterval(prev.intervalTimer);
	if (prev?.dismissTimer) clearTimeout(prev.dismissTimer);
	prev?.abortController?.abort();

	const config = await loadRecapConfig(process.cwd());
	if (!config.enabled) {
		g[INSTANCE_KEY] = undefined;
		return;
	}

	let lastRecapMessageCount = 0;
	let dismissTimer: TimeoutTimer | null = null;
	let intervalTimer: IntervalTimer | null = null;
	let activeAbortController: AbortController | null = null;
	let latestRequestedSeq = 0;
	let agentRunActive = false;

	const instanceState: StoredState = {
		get intervalTimer() {
			return intervalTimer ?? undefined;
		},
		get dismissTimer() {
			return dismissTimer ?? undefined;
		},
		get abortController() {
			return activeAbortController ?? undefined;
		},
	};
	g[INSTANCE_KEY] = instanceState;

	function showRecap(
		ctx: ExtensionContext,
		summary: string,
		options: { notifyOnDismiss?: boolean } = {},
	): void {
		const recap = formatRecap(summary);
		ctx.ui.setWidget(WIDGET_KEY, [recap], {
			placement: "aboveEditor",
		});
		if (dismissTimer) clearTimeout(dismissTimer);
		if (config.displaySeconds > 0) {
			dismissTimer = setTimeout(() => {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				if (options.notifyOnDismiss) ctx.ui.notify(recap, "info");
				dismissTimer = null;
			}, config.displaySeconds * 1000);
		}
	}

	function scheduleRecap(
		ctx: ExtensionContext,
		options: { notifyGenerating?: boolean; force?: boolean; notifyOnDismiss?: boolean } = {},
	): void {
		const collected = collectMessages(ctx.sessionManager);
		if (collected.messageCount === 0) {
			if (options.notifyGenerating) ctx.ui.notify("[recap] No messages to recap.", "info");
			return;
		}
		if (!options.force && collected.messageCount === lastRecapMessageCount) return;

		activeAbortController?.abort();
		const abortController = new AbortController();
		activeAbortController = abortController;

		if (options.notifyGenerating) ctx.ui.notify("[recap] Generating...", "info");

		const snapshot: RecapSnapshot = {
			ctx,
			text: collected.text,
			messageCount: collected.messageCount,
			systemPrompt: ctx.getSystemPrompt(),
			notifyOnDismiss: options.notifyOnDismiss ?? false,
			seq: ++latestRequestedSeq,
			signal: abortController.signal,
		};
		void runRecap(snapshot, abortController);
	}

	async function runRecap(
		snapshot: RecapSnapshot,
		abortController: AbortController,
	): Promise<void> {
		const summary = await generateRecap(
			snapshot.text,
			snapshot.systemPrompt,
			config.model,
			snapshot.ctx.modelRegistry,
			snapshot.signal,
		);

		if (activeAbortController === abortController) {
			activeAbortController = null;
		}
		if (!summary || snapshot.signal.aborted) return;
		if (snapshot.seq !== latestRequestedSeq) return;

		lastRecapMessageCount = snapshot.messageCount;
		showRecap(snapshot.ctx, summary, { notifyOnDismiss: snapshot.notifyOnDismiss });
	}

	function stopCountdown(): void {
		if (!intervalTimer) return;
		clearInterval(intervalTimer);
		intervalTimer = null;
	}

	function startCountdown(ctx: ExtensionContext): void {
		stopCountdown();
		if (config.intervalMinutes <= 0) return;
		const intervalMs = config.intervalMinutes * 60 * 1000;
		intervalTimer = setInterval(() => {
			if (!agentRunActive) return;
			scheduleRecap(ctx);
		}, intervalMs);
		intervalTimer.unref?.();
	}

	if (config.onAgentEnd) {
		pi.on("agent_end", (_event, ctx) => {
			agentRunActive = false;
			stopCountdown();
			scheduleRecap(ctx, { force: true, notifyOnDismiss: true });
		});
	} else {
		pi.on("agent_end", () => {
			agentRunActive = false;
			stopCountdown();
			activeAbortController?.abort();
			activeAbortController = null;
		});
	}

	pi.on("agent_start", (_event, ctx) => {
		agentRunActive = true;
		startCountdown(ctx);
	});

	pi.registerCommand("recap", {
		description: "Trigger a recap immediately",
		async handler(_args, ctx) {
			scheduleRecap(ctx, {
				notifyGenerating: true,
				force: true,
				notifyOnDismiss: !agentRunActive,
			});
		},
	});

	pi.on("session_shutdown", () => {
		if (intervalTimer) {
			clearInterval(intervalTimer);
			intervalTimer = null;
		}
		if (dismissTimer) {
			clearTimeout(dismissTimer);
			dismissTimer = null;
		}
		activeAbortController?.abort();
		activeAbortController = null;
		g[INSTANCE_KEY] = undefined;
	});
}
