/**
 * Boulder Hook - Automatic loop enforcement for pending tasks.
 *
 * When the agent loop ends with pending tasks remaining, this hook
 * restarts the loop by sending a follow-up user message listing
 * the outstanding tasks.
 *
 * Safety mechanisms:
 * - Injection failure backoff: cooldown increases from 5s to 160s on sendUserMessage failures
 * - Normal restart cooldown: fixed 10s with countdown toast notification
 * - Stagnation detection: stops after 3 restarts with no progress (same pending count)
 * - Abort awareness: delays restart 3s after detecting an aborted message
 * - Pending question detection: skips restart if agent is asking a question
 * - Compaction guard: skips restart within 60s after context compaction
 * - External stop: respects `isStopped()` callback from /omp-stop command
 *
 * Named after Sisyphus' boulder — it keeps rolling back.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { CONFIRM_STOP_TAG } from "../tools/task.js";

interface TaskState {
  tasks: { id: number; text: string; status: string }[];
  pendingCount: number;
}

// ─── Module-level state for backoff / stagnation / abort detection ──────────

/** Number of consecutive sendUserMessage injection failures */
let injectionFailures = 0;

/** Maximum injection failures before giving up */
const MAX_INJECTION_FAILURES = 5;

/** Normal cooldown between restarts (ms) */
const NORMAL_COOLDOWN_MS = 10000;

/** Pending count at the time of the last restart — used to detect progress */
let lastPendingCount = Infinity;

/** Number of consecutive restarts where pending count stayed the same */
let stagnationCount = 0;

/** Timestamp of the last detected abort — used to delay restart */
let lastAbortTime = 0;

/** Timestamp of the last context compaction — used for compaction guard */
let lastCompactionTime = 0;

/** Grace period after compaction before allowing restart (ms) */
const COMPACTION_GUARD_MS = 60000;

/** Minimum length for an assistant message to NOT be considered aborted */
const ABORT_TEXT_MIN_LENGTH = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Heuristic: detect if the last assistant message was likely aborted.
 * An aborted turn typically ends with an extremely short assistant message
 * or an error content block.
 */
function looksAborted(messages: readonly { role: string; content?: unknown }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AssistantMessage;
    if (m.role !== "assistant") continue;

    // Check for error content blocks
    const hasError = m.content.some(
      (c) => c.type === "text" && /\berror\b/i.test(c.text) && c.text.length < ABORT_TEXT_MIN_LENGTH,
    );
    if (hasError) return true;

    // Very short final assistant message suggests an abort mid-generation
    const totalText = m.content
      .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join("");
    if (totalText.length < ABORT_TEXT_MIN_LENGTH && totalText.length > 0) return true;

    // Only inspect the last assistant message
    break;
  }
  return false;
}

/**
 * Detect if the last assistant message ends with a question or uses a question tool.
 * If so, the agent is waiting for user input and should not be auto-restarted.
 */
function isAskingQuestion(messages: readonly { role: string; content?: unknown }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AssistantMessage;
    if (m.role !== "assistant") continue;

    // Check if text ends with a question mark
    const text = m.content
      .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join("");
    if (text.trim().endsWith("?")) return true;

    // Check for question tool use
    const hasQuestionTool = m.content.some(
      (c) => c.type === "toolCall" && c.name === "question",
    );
    if (hasQuestionTool) return true;

    // Only inspect the last assistant message
    break;
  }
  return false;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerBoulder(
  pi: ExtensionAPI,
  getTaskState: () => TaskState,
  isStopped?: () => boolean,
): void {
  // ── Compaction guard: track when compaction occurs ──────────────────────
  pi.on("session_compact", async () => {
    lastCompactionTime = Date.now();
  });

  // ── Reset module-level state on session switch/fork ───────────────────
  // These counters are session-specific; carrying them across sessions
  // would cause incorrect backoff/stagnation behaviour for the new session.
  const resetBoulderState = () => {
    injectionFailures = 0;
    stagnationCount = 0;
    lastPendingCount = Infinity;
    lastAbortTime = 0;
    lastCompactionTime = 0;
  };
  pi.on("session_switch", async () => { resetBoulderState(); });
  pi.on("session_fork", async () => { resetBoulderState(); });
  pi.on("session_tree", async () => { resetBoulderState(); });

  pi.on("agent_end", async (event, ctx) => {
    try {
      // Respect /omp-stop command
      if (isStopped?.()) return;

      const { tasks, pendingCount } = getTaskState();
      if (pendingCount === 0) {
        // All tasks cleared — reset state
        injectionFailures = 0;
        lastPendingCount = Infinity;
        stagnationCount = 0;
        return;
      }

      // Check if the agent explicitly acknowledged it cannot continue right now.
      const confirmedStop = event.messages.some((m) => {
        const assistant = m as AssistantMessage;
        if (assistant.role !== "assistant") return false;
        return assistant.content.some(
          (c) => c.type === "text" && c.text.includes(CONFIRM_STOP_TAG),
        );
      });
      if (confirmedStop) return;

      // ── Pending question detection ──────────────────────────────────────
      // If the agent is asking a question, don't auto-restart — wait for user input.
      if (isAskingQuestion(event.messages)) return;

      // ── Compaction guard ───────────────────────────────────────────────
      // Skip restart if compaction happened recently — context may be unstable.
      if (Date.now() - lastCompactionTime < COMPACTION_GUARD_MS) return;

      // ── Abort awareness ──────────────────────────────────────────────────
      // If the last message looks aborted, record the time and add a 3s delay.
      if (looksAborted(event.messages)) {
        lastAbortTime = Date.now();
      }
      const timeSinceAbort = Date.now() - lastAbortTime;
      const abortDelay = timeSinceAbort < 3000 ? 3000 - timeSinceAbort : 0;

      // ── Stagnation detection ─────────────────────────────────────────────
      // If pending count hasn't changed across restarts, increment stagnation.
      if (pendingCount === lastPendingCount) {
        stagnationCount++;
      } else {
        stagnationCount = 0;
      }

      // ── Progress detection for failure reset ──────────────────────────
      if (pendingCount < lastPendingCount) {
        // Progress was made — reset injection failure counter
        injectionFailures = 0;
      }
      lastPendingCount = pendingCount;

      // ── Stagnation hard stop ─────────────────────────────────────────────
      if (stagnationCount >= 3) {
        const stagnationMessage = [
          `Agent appears stuck after ${stagnationCount} restarts with no progress (${pendingCount} tasks still pending).`,
          "Stopping auto-continuation.",
          "",
          "Use the task tool to expire stale tasks, or output " + CONFIRM_STOP_TAG + " if blocked.",
        ].join("\n");

        try {
          if (ctx.isIdle()) {
            pi.sendUserMessage(stagnationMessage);
          } else {
            pi.sendUserMessage(stagnationMessage, { deliverAs: "followUp" });
          }
          injectionFailures = 0;
        } catch {
          injectionFailures++;
        }
        // Reset stagnation so that if the agent responds and still has pending,
        // it gets another 3 chances before stopping again
        stagnationCount = 0;
        return;
      }

      // ── Build restart message ────────────────────────────────────────────
      const pending = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
      const taskLines = pending
        .map((t) => `  - [#${t.id}] ${t.text}`)
        .join("\n");

      const restartNote =
        injectionFailures > 0
          ? `\n\n(Auto-restart after ${injectionFailures} injection failure(s). Backoff active.)`
          : "";

      const message = [
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

      // ── Cooldown calculation ───────────────────────────────────────────
      // Injection failures: exponential backoff 5s * 2^failures (5s → 160s)
      // Normal restarts: fixed 10s cooldown (matches countdown toast)
      const cooldownMs = injectionFailures > 0
        ? NORMAL_COOLDOWN_MS / 2 * Math.pow(2, Math.min(injectionFailures, 5))
        : NORMAL_COOLDOWN_MS;
      const totalDelay = Math.max(cooldownMs, abortDelay);

      // ── Countdown toast notification ───────────────────────────────────
      if (ctx.hasUI) {
        ctx.ui.notify(`Restarting in ${Math.ceil(totalDelay / 1000)}s... (${pendingCount} tasks remaining)`, "info");
      }

      // Use setTimeout to delay the restart message (non-blocking)
      setTimeout(() => {
        // Re-check stop flag after delay
        if (isStopped?.()) return;

        // Re-check compaction guard after delay
        if (Date.now() - lastCompactionTime < COMPACTION_GUARD_MS) return;

        try {
          if (ctx.isIdle()) {
            pi.sendUserMessage(message);
          } else {
            pi.sendUserMessage(message, { deliverAs: "followUp" });
          }
          injectionFailures = 0; // Success — reset failure counter
        } catch {
          injectionFailures++;
          if (injectionFailures >= MAX_INJECTION_FAILURES) {
            // Too many consecutive injection failures — stop trying
            if (ctx.hasUI) {
              ctx.ui.notify(
                `Boulder: gave up after ${MAX_INJECTION_FAILURES} injection failures. Use /omp-continue to retry.`,
                "warning",
              );
            }
          }
        }
      }, totalDelay);
    } catch {
      // Hooks must never throw — silently continue
    }
  });
}
