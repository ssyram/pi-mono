/**
 * Boulder Hook - Automatic loop enforcement for pending tasks.
 *
 * When the agent loop ends with pending tasks remaining, this hook
 * restarts the loop by sending a follow-up user message listing
 * the outstanding tasks.
 *
 * Safety mechanisms:
 * - Confirm-to-stop tag in the LAST assistant message suppresses restart
 * - User abort (Esc during generation) suppresses restart
 * - Countdown with Esc cancellation before restart fires
 * - Injection failure backoff (exponential 5s-160s)
 * - Stagnation detection: stops after 3 restarts with no progress
 * - Pending question detection: skips restart if agent is asking a question
 * - Compaction guard: skips restart within 60s after context compaction
 * - Background task awareness: skips restart while background tasks are running
 * - External stop: respects `isStopped()` callback from /omp-stop command
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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_INJECTION_FAILURES = 5;
const NORMAL_COOLDOWN_MS = 10000;
const COMPACTION_GUARD_MS = 60000;

// ─── Module-level state ─────────────────────────────────────────────────────

let injectionFailures = 0;
let lastPendingCount = Infinity;
let stagnationCount = 0;
let lastAbortTime = 0;
let lastCompactionTime = 0;
let activeCountdown: CountdownHandle | undefined;

function resetBoulderState(): void {
  injectionFailures = 0;
  stagnationCount = 0;
  lastPendingCount = Infinity;
  lastAbortTime = 0;
  lastCompactionTime = 0;
  activeCountdown?.cancel();
  activeCountdown = undefined;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerBoulder(
  pi: ExtensionAPI,
  getTaskState: () => TaskState,
  isStopped?: () => boolean,
  hasRunningTasks?: () => boolean,
): void {
  pi.on("session_compact", async () => { lastCompactionTime = Date.now(); });
  pi.on("session_switch", async () => { resetBoulderState(); });
  pi.on("session_fork", async () => { resetBoulderState(); });
  pi.on("session_tree", async () => { resetBoulderState(); });

  pi.on("agent_end", async (event, ctx) => {
    try {
      // Cancel any in-flight countdown from a previous agent_end
      activeCountdown?.cancel();
      activeCountdown = undefined;

      if (isStopped?.()) return;

      const { tasks, pendingCount } = getTaskState();
      if (pendingCount === 0) {
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
      if (pendingCount === lastPendingCount) {
        stagnationCount++;
      } else {
        stagnationCount = 0;
      }
      if (pendingCount < lastPendingCount) injectionFailures = 0;
      lastPendingCount = pendingCount;

      if (stagnationCount >= 3) {
        handleStagnation(pi, ctx, pendingCount);
        return;
      }

      // ── Build restart message ──────────────────────────────────────────
      const message = buildRestartMessage(tasks, pendingCount);

      // ── Cooldown ───────────────────────────────────────────────────────
      const cooldownMs = injectionFailures > 0
        ? NORMAL_COOLDOWN_MS / 2 * Math.pow(2, Math.min(injectionFailures, 5))
        : NORMAL_COOLDOWN_MS;
      const totalDelay = Math.max(cooldownMs, abortDelay);

      // ── Start countdown (with Esc cancellation if UI available) ────────
      const fire = () => {
        if (isStopped?.()) return;
        if (Date.now() - lastCompactionTime < COMPACTION_GUARD_MS) return;
        if (hasRunningTasks?.()) return;

        // Re-fetch task state — it may have changed during the countdown
        const fresh = getTaskState();
        if (fresh.pendingCount === 0) return;

        const freshMessage = buildRestartMessage(fresh.tasks, fresh.pendingCount);
        sendRestart(pi, ctx, freshMessage);
      };

      activeCountdown = ctx.hasUI
        ? startCountdown(ctx, totalDelay, pendingCount, fire)
        : startSilentCountdown(totalDelay, fire);
    } catch {
      // Hooks must never throw
    }
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function handleStagnation(
  pi: ExtensionAPI,
  ctx: { isIdle: () => boolean; hasUI: boolean; ui: { notify: (m: string, t: string) => void } },
  pendingCount: number,
): void {
  const msg = [
    `Agent appears stuck after ${stagnationCount} restarts with no progress (${pendingCount} tasks still pending).`,
    "Stopping auto-continuation.",
    "",
    "Use the task tool to expire stale tasks, or output " + CONFIRM_STOP_TAG + " if blocked.",
  ].join("\n");

  try {
    if (ctx.isIdle()) {
      pi.sendUserMessage(msg);
    } else {
      pi.sendUserMessage(msg, { deliverAs: "followUp" });
    }
    injectionFailures = 0;
  } catch {
    injectionFailures++;
  }
  stagnationCount = 0;
}

function buildRestartMessage(
  tasks: { id: number; text: string; status: string }[],
  pendingCount: number,
): string {
  const pending = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  const taskLines = pending.map((t) => `  - [#${t.id}] ${t.text}`).join("\n");
  const restartNote = injectionFailures > 0
    ? `\n\n(Auto-restart after ${injectionFailures} injection failure(s). Backoff active.)`
    : "";

  return [
    "You have pending tasks that are not complete:",
    taskLines,
    "",
    "Please continue working on them. For each task, either:",
    "  - Complete the work and mark it done",
    "  - Expire it if no longer relevant",
    "",
    `If you genuinely cannot continue right now, output ${CONFIRM_STOP_TAG} to acknowledge and stop.`,
    restartNote,
  ].join("\n");
}

function sendRestart(
  pi: ExtensionAPI,
  ctx: { isIdle: () => boolean; hasUI: boolean; ui: { notify: (m: string, t: string) => void } },
  message: string,
): void {
  try {
    if (ctx.isIdle()) {
      pi.sendUserMessage(message);
    } else {
      pi.sendUserMessage(message, { deliverAs: "followUp" });
    }
    injectionFailures = 0;
  } catch {
    injectionFailures++;
    if (injectionFailures >= MAX_INJECTION_FAILURES && ctx.hasUI) {
      ctx.ui.notify(
        `Boulder: gave up after ${MAX_INJECTION_FAILURES} injection failures. Use /omp-continue to retry.`,
        "warning",
      );
    }
  }
}
