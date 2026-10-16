import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { formatBoulderDelay } from "./boulder-retry-policy.js";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";

const STATUS_KEY = "boulder-countdown";

export interface CountdownHandle {
	cancel(): void;
}

interface CountdownOptions {
	context: ExtensionContext;
	delayMs: number;
	attempt: number;
	limit: number;
	actionable: number;
	onFinish(): void;
	onError(error: unknown): void;
	onEscape(): void;
}

export function startCountdown(options: CountdownOptions): CountdownHandle {
	const { context, delayMs, attempt, limit, actionable, onFinish, onError, onEscape } = options;
	let cancelled = false;
	let remainingMs = delayMs;
	let unsubscribeInput: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const reportError = (error: unknown): void => {
		try {
			onError(error);
		} catch (reportError) {
			reportBoulderDiagnostic(
				`[oh-my-pi boulder] Countdown error reporter failed: ${describeThrown(reportError)}`,
			);
		}
	};
	const cleanup = (): void => {
		if (cancelled) return;
		cancelled = true;
		if (timer) clearTimeout(timer);
		if (refreshTimer) clearTimeout(refreshTimer);
		try {
			context.ui.setStatus(STATUS_KEY, undefined);
		} catch (error) {
			reportError(error);
		}
		try {
			unsubscribeInput?.();
		} catch (error) {
			reportError(error);
		}
	};
	const finish = (): void => {
		if (cancelled) return;
		cleanup();
		try {
			onFinish();
		} catch (error) {
			reportError(error);
		}
	};

	const renderStatus = (): void => {
		context.ui.setStatus(
			STATUS_KEY,
			`Boulder: resume attempt ${attempt}/${limit} in ${formatBoulderDelay(remainingMs)} (${actionable} actionable tasks) — press Esc to cancel`,
		);
		if (remainingMs <= 1_000) return;
		refreshTimer = setTimeout(() => {
			try {
				remainingMs -= 1_000;
				renderStatus();
			} catch (error) {
				cleanup();
				reportError(error);
			}
		}, 1_000);
	};

	try {
		renderStatus();
		timer = setTimeout(finish, delayMs);
		unsubscribeInput = context.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "escape") || cancelled) return undefined;
			cleanup();
			try {
				context.ui.notify("Task restart cancelled.", "info");
				onEscape();
			} catch (error) {
				reportError(error);
			}
			return { consume: true };
		});
	} catch (error) {
		cleanup();
		reportError(error);
	}
	return { cancel: cleanup };
}

export function startSilentCountdown(
	delayMs: number,
	onFinish: () => void,
	onError: (error: unknown) => void,
): CountdownHandle {
	let cancelled = false;
	const timer = setTimeout(() => {
		if (cancelled) return;
		cancelled = true;
		try {
			onFinish();
		} catch (error) {
			try {
				onError(error);
			} catch (reportError) {
				reportBoulderDiagnostic(`[oh-my-pi boulder] Silent countdown reporter failed: ${describeThrown(reportError)}`);
			}
		}
	}, delayMs);
	return {
		cancel() {
			cancelled = true;
			clearTimeout(timer);
		},
	};
}
