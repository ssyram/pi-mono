import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

const STATUS_KEY = "boulder-countdown";

export interface CountdownHandle {
  cancel: () => void;
}

interface CountdownOptions {
  ctx: ExtensionContext;
  totalMs: number;
  actionable: number;
  onFinish: () => void;
  onError: (err: unknown) => void;
}

export function startCountdown(options: CountdownOptions): CountdownHandle {
  const { ctx, totalMs, actionable, onFinish, onError } = options;
  let remaining = Math.ceil(totalMs / 1000);
  let cancelled = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let unsubscribeInput: (() => void) | undefined;

  const reportError = (err: unknown) => {
    try {
      onError(err);
    } catch (reportErr) {
      console.error(`[oh-my-pi boulder] Countdown error reporter failed: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
    }
  };

  const updateStatus = () => {
    ctx.ui.setStatus(STATUS_KEY, `Restarting in ${remaining}s (${actionable} actionable tasks) — press Esc to cancel`);
  };

  const cleanup = () => {
    cancelled = true;
    if (ticker) clearInterval(ticker);
    try {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    } catch (err) {
      reportError(err);
    }
    try {
      unsubscribeInput?.();
    } catch (err) {
      reportError(err);
    }
  };

  const finish = () => {
    if (cancelled) return;
    cleanup();
    try {
      onFinish();
    } catch (err) {
      reportError(err);
    }
  };

  try {
    updateStatus();
    ticker = setInterval(() => {
      try {
        remaining--;
        if (remaining <= 0) {
          finish();
          return;
        }
        updateStatus();
      } catch (err) {
        cleanup();
        reportError(err);
      }
    }, 1000);

    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      try {
        if (matchesKey(data, "escape") && !cancelled) {
          cleanup();
          try {
            ctx.ui.notify("Task restart cancelled.", "info");
          } catch (err) {
            reportError(err);
          }
          return { consume: true };
        }
      } catch (err) {
        cleanup();
        reportError(err);
      }
      return undefined;
    });
  } catch (err) {
    cleanup();
    reportError(err);
  }

  return {
    cancel: () => {
      if (!cancelled) cleanup();
    },
  };
}

export function startSilentCountdown(
  totalMs: number,
  onFinish: () => void,
  onError: (err: unknown) => void,
): CountdownHandle {
  let cancelled = false;
  const reportError = (err: unknown) => {
    try {
      onError(err);
    } catch (reportErr) {
      console.error(`[oh-my-pi boulder] Silent countdown error reporter failed: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
    }
  };
  const timer = setTimeout(() => {
    if (cancelled) return;
    try {
      onFinish();
    } catch (err) {
      reportError(err);
    }
  }, totalMs);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
