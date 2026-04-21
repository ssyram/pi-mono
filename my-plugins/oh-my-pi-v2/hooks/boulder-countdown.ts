/**
 * Boulder countdown timer with Esc cancellation.
 *
 * Shows a ticking countdown in the status bar. The user can press Esc
 * at any time during the countdown to cancel the pending restart.
 * When the countdown reaches zero, the provided callback fires.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

const STATUS_KEY = "boulder-countdown";

export interface CountdownHandle {
  /** Cancel the countdown programmatically. */
  cancel: () => void;
}

/**
 * Start a visible countdown in the status bar.
 *
 * @param ctx        Extension context (must have UI)
 * @param totalMs    Total countdown duration in milliseconds
 * @param pending    Number of pending tasks (shown in status text)
 * @param onFinish   Called when countdown reaches zero without cancellation
 * @returns Handle with a `cancel()` method
 */
export function startCountdown(
  ctx: ExtensionContext,
  totalMs: number,
  pending: number,
  onFinish: () => void,
): CountdownHandle {
  let remaining = Math.ceil(totalMs / 1000);
  let cancelled = false;

  const updateStatus = () => {
    ctx.ui.setStatus(
      STATUS_KEY,
      `Restarting in ${remaining}s (${pending} tasks) — press Esc to cancel`,
    );
  };

  const cleanup = () => {
    cancelled = true;
    clearInterval(ticker);
    ctx.ui.setStatus(STATUS_KEY, undefined);
    unsubInput();
  };

  // Tick every second
  updateStatus();
  const ticker = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      cleanup();
      onFinish();
      return;
    }
    updateStatus();
  }, 1000);

  // Intercept Esc to cancel
  const unsubInput = ctx.ui.onTerminalInput((data) => {
    if (matchesKey(data, "escape") && !cancelled) {
      cleanup();
      ctx.ui.notify("Task restart cancelled.", "info");
      return { consume: true };
    }
    return undefined;
  });

  return {
    cancel: () => {
      if (!cancelled) cleanup();
    },
  };
}

/**
 * Delay with a plain setTimeout (no UI). Used as fallback when ctx.hasUI is false.
 */
export function startSilentCountdown(
  totalMs: number,
  onFinish: () => void,
): CountdownHandle {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (!cancelled) onFinish();
  }, totalMs);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
