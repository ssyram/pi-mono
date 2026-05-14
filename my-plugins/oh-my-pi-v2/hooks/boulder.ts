/**
 * Boulder Hook - Automatic loop enforcement for actionable tasks.
 *
 * When the agent loop ends with actionable tasks remaining, this hook
 * restarts the loop by sending a follow-up user message listing
 * the active/ready work.
 *
 * Safety mechanisms:
 * - Confirm-to-stop tag in the LAST assistant message suppresses restart
 * - User abort (Esc during generation) suppresses restart
 * - Countdown with one-shot Esc cancellation before restart fires
 * - Injection failure backoff (exponential 10s-160s)
 * - Stagnation detection: stops after 3 restarts with no progress
 * - Pending question detection: skips restart if agent is asking a question
 * - Compaction guard: skips restart within 10s after context compaction
 * - Background task awareness: skips restart while background tasks are running
 * - Failure observability: logs failures and disables Boulder after repeated failures
 *
 * Named after Sisyphus' boulder — it keeps rolling back.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { CountdownHandle } from "./boulder-countdown.js";
import { startCountdown, startSilentCountdown } from "./boulder-countdown.js";
import { hasConfirmStop, isAskingQuestion, looksAborted, wasAborted } from "./boulder-helpers.js";
import { CONFIRM_STOP_TAG } from "../tools/task.js";

interface TaskState {
  tasks: { id: number; text: string; status: string }[];
  pendingCount: number;
  actionableCount: number;
  readyTasks: { id: number; text: string; status: string }[];
}

interface BoulderContext {
  isIdle: () => boolean;
  hasUI: boolean;
  ui: { notify: (m: string, t?: "info" | "warning" | "error") => void };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_INJECTION_FAILURES = 5;
const NORMAL_COOLDOWN_MS = 10000;
const COMPACTION_GUARD_MS = 10000;

// ─── Module-level state ─────────────────────────────────────────────────────

let injectionFailures = 0;
let lastPendingCount = Infinity;
let lastPendingIds: Set<number> = new Set();
let stagnationCount = 0;
let lastAbortTime = 0;
let lastCompactionTime = 0;
let activeCountdown: CountdownHandle | undefined;
let disabled = false;

function resetBoulderState(): void {
  injectionFailures = 0;
  stagnationCount = 0;
  lastPendingCount = Infinity;
  lastPendingIds = new Set();
  lastAbortTime = 0;
  lastCompactionTime = 0;
  activeCountdown?.cancel();
  activeCountdown = undefined;
  disabled = false;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerBoulder(
  pi: ExtensionAPI,
  getTaskState: () => TaskState,
  hasRunningTasks?: () => boolean,
): void {
  pi.on("session_compact", async () => { lastCompactionTime = Date.now(); });
  pi.on("session_start", async (event) => {
    if (event.reason === "new" || event.reason === "resume" || event.reason === "fork") {
      resetBoulderState();
    }
  });
  pi.on("session_tree", async () => { resetBoulderState(); });

  pi.on("agent_end", async (event, ctx) => {
    try {
      if (disabled) return;

      // Cancel any in-flight countdown from a previous agent_end
      activeCountdown?.cancel();
      activeCountdown = undefined;

      const { tasks, actionableCount, readyTasks } = getTaskState();
      if (actionableCount === 0) {
        injectionFailures = 0;
        lastPendingCount = Infinity;
        stagnationCount = 0;
        return;
      }

      // ── Suppress restart: confirm-to-stop tag (last message only) ──────
      if (hasConfirmStop(event.messages)) return;

      // ── Suppress restart: user aborted (Esc during generation) ─────────
      if (wasAborted(event.messages)) return;

      // ── Suppress restart: agent is asking a question ───────────────────
      if (isAskingQuestion(event.messages)) return;

      // ── Suppress restart: compaction guard ─────────────────────────────
      if (Date.now() - lastCompactionTime < COMPACTION_GUARD_MS) return;

      // ── Suppress restart: background tasks still running ───────────────
      if (hasRunningTasks?.()) return;

      // ── Abort heuristic delay (for non-stopReason aborts) ──────────────
      if (looksAborted(event.messages)) {
        lastAbortTime = Date.now();
      }
      const timeSinceAbort = Date.now() - lastAbortTime;
      const abortDelay = timeSinceAbort < 3000 ? 3000 - timeSinceAbort : 0;

      // ── Stagnation detection ───────────────────────────────────────────
      // Compare the SET of actionable task IDs, not just the count.
      // This prevents false positives when the agent adds and completes
      // tasks in the same turn (count stays same but IDs differ → progress).
      const currentPendingIds = new Set(getActionableTasks(tasks, readyTasks).map((t) => t.id));
      const idsUnchanged = currentPendingIds.size === lastPendingIds.size
        && [...currentPendingIds].every((id) => lastPendingIds.has(id));

      if (idsUnchanged) {
        stagnationCount++;
      } else {
        stagnationCount = 0;
      }
      if (actionableCount < lastPendingCount) injectionFailures = 0;
      lastPendingCount = actionableCount;
      lastPendingIds = currentPendingIds;

      if (stagnationCount >= 3) {
        handleStagnation(pi, ctx, actionableCount);
        return;
      }

      // ── Build restart message ──────────────────────────────────────────
      const message = buildRestartMessage(tasks, readyTasks, actionableCount);

      // ── Cooldown ───────────────────────────────────────────────────────
      const cooldownMs = injectionFailures > 0
        ? NORMAL_COOLDOWN_MS * Math.pow(2, Math.min(injectionFailures, 4))
        : NORMAL_COOLDOWN_MS;
      const totalDelay = Math.max(cooldownMs, abortDelay);

      // ── Start countdown (with Esc cancellation if UI available) ────────
      const fire = () => {
        activeCountdown = undefined;
        if (disabled) return;
        if (Date.now() - lastCompactionTime < COMPACTION_GUARD_MS) return;
        if (hasRunningTasks?.()) return;

        // Re-fetch task state — it may have changed during the countdown
        const fresh = getTaskState();
        if (fresh.actionableCount === 0) return;

        const freshMessage = buildRestartMessage(fresh.tasks, fresh.readyTasks, fresh.actionableCount);
        sendRestart(pi, ctx, freshMessage);
      };

      const onCountdownError = (err: unknown) => {
        recordBoulderFailure(ctx, "Boulder countdown failed", err);
      };

      activeCountdown = ctx.hasUI
        ? startCountdown({ ctx, totalMs: totalDelay, actionable: actionableCount, onFinish: fire, onError: onCountdownError })
        : startSilentCountdown(totalDelay, fire, onCountdownError);
    } catch (err) {
      recordBoulderFailure(ctx, "Boulder hook failed", err);
    }
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function getActionableTasks(
  tasks: { id: number; text: string; status: string }[],
  readyTasks: { id: number; text: string; status: string }[],
): { id: number; text: string; status: string }[] {
  return [...tasks.filter((t) => t.status === "in_progress"), ...readyTasks];
}

function notifyBoulderFailure(ctx: BoulderContext, message: string): void {
  try {
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
  } catch (err) {
    console.error(`[oh-my-pi boulder] Failed to notify user: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function recordBoulderFailure(ctx: BoulderContext, message: string, err: unknown): void {
  injectionFailures++;
  console.error(`[oh-my-pi boulder] ${message}: ${err instanceof Error ? err.message : String(err)}`);
  if (injectionFailures >= MAX_INJECTION_FAILURES) {
    disabled = true;
    activeCountdown?.cancel();
    activeCountdown = undefined;
    notifyBoulderFailure(ctx, `Boulder disabled after ${MAX_INJECTION_FAILURES} failures. Restart the session to retry.`);
  }
}

function handleStagnation(
  pi: ExtensionAPI,
  ctx: BoulderContext,
  actionableCount: number,
): void {
  const msg = [
    `Agent appears stuck after ${stagnationCount} restarts with no progress (${actionableCount} actionable tasks remain).`,
    "Stopping auto-continuation.",
    "",
    "Use the task tool to expire stale tasks with a reason, or output " + CONFIRM_STOP_TAG + " if blocked.",
  ].join("\n");

  try {
    if (ctx.isIdle()) {
      pi.sendUserMessage(msg);
    } else {
      pi.sendUserMessage(msg, { deliverAs: "followUp" });
    }
    injectionFailures = 0;
    disabled = true;
    activeCountdown?.cancel();
    activeCountdown = undefined;
  } catch (err) {
    recordBoulderFailure(ctx, "Failed to send stagnation message", err);
  }
  stagnationCount = 0;
}

function buildRestartMessage(
  tasks: { id: number; text: string; status: string }[],
  readyTasks: { id: number; text: string; status: string }[],
  actionableCount: number,
): string {
  const actionable = getActionableTasks(tasks, readyTasks);
  const taskLines = actionable.map((t) => `  - [#${t.id}] ${t.text}`).join("\n");
  const restartNote = injectionFailures > 0
    ? `\n\n(Auto-restart after ${injectionFailures} injection failure(s). Backoff active.)`
    : "";

  return [
    "You have active/ready work remaining:",
    taskLines,
    "",
    "Please continue working on them. For each task, either:",
    "  - Complete the work and mark it done",
    "  - Expire it with a reason if no longer relevant",
    "",
    `If you genuinely cannot continue right now, output ${CONFIRM_STOP_TAG} to acknowledge and stop.`,
    restartNote,
  ].join("\n");
}

function sendRestart(
  pi: ExtensionAPI,
  ctx: BoulderContext,
  message: string,
): void {
  try {
    if (ctx.isIdle()) {
      pi.sendUserMessage(message);
    } else {
      pi.sendUserMessage(message, { deliverAs: "followUp" });
    }
    injectionFailures = 0;
  } catch (err) {
    recordBoulderFailure(ctx, "Failed to send restart message", err);
  }
}
