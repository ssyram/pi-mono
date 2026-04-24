/**
 * Context Recovery Hook - Monitors context usage and manages compaction.
 *
 * - 70%: injects a reminder that context is filling but still has room.
 * - 78%: triggers automatic compaction (once per session).
 * - After compaction: injects active task list so the model does not lose track.
 */

import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  SessionCompactEvent,
} from "@mariozechner/pi-coding-agent";

import type { Task } from "../tools/task.js";

const WARN_THRESHOLD = 70;
const AUTO_COMPACT_THRESHOLD = 78;

/** Sessions that already received the 70% hint. */
const warnedSessions = new Set<string>();

/** Sessions with auto-compaction in-flight or already attempted successfully. */
const compactedSessions = new Set<string>();

export function registerContextRecovery(
  pi: ExtensionAPI,
  getTaskState: () => { tasks: Task[]; actionableCount: number; readyTasks: Task[] },
): void {
  // ── before_agent_start: threshold monitoring ────────────────────────────
  pi.on(
    "before_agent_start",
    async (event: BeforeAgentStartEvent, ctx) => {
      try {
        const usage = ctx.getContextUsage();
        if (!usage || usage.percent === null) return undefined;

        const sessionId =
          ctx.sessionManager.getSessionId() ?? "__default__";

        // Auto-compact at 78% (once per session)
        if (
          usage.percent >= AUTO_COMPACT_THRESHOLD &&
          !compactedSessions.has(sessionId)
        ) {
          ctx.compact({
            onComplete: () => {
              console.error(`[oh-my-pi context] Auto-compaction completed for session ${sessionId}`);
            },
            onError: (error) => {
              compactedSessions.delete(sessionId);
              console.error(`[oh-my-pi context] Auto-compaction failed for session ${sessionId}: ${error.message}`);
            },
          });
          compactedSessions.add(sessionId);
          return {
            systemPrompt:
              event.systemPrompt +
              "\n\n## Context Auto-Compaction Triggered\n\nContext usage exceeded " +
              AUTO_COMPACT_THRESHOLD +
              "%. Compaction has been initiated automatically. " +
              "Keep your responses concise to preserve context space.",
          };
        }

        // Warning at 70% (once per session)
        if (
          usage.percent >= WARN_THRESHOLD &&
          !warnedSessions.has(sessionId)
        ) {
          warnedSessions.add(sessionId);
          return {
            systemPrompt:
              event.systemPrompt +
              "\n\n## Context Usage Notice\n\n" +
              "You are using " +
              Math.round(usage.percent) +
              "% of context. " +
              "You still have context remaining \u2014 do NOT rush or skip tasks.",
          };
        }

        return undefined;
      } catch (err) {
        console.error(`[oh-my-pi context] before_agent_start failed: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    },
  );

  // ── session_compact: restore active tasks after compaction ───────────────
  pi.on(
    "session_compact",
    async (_event: SessionCompactEvent, ctx) => {
      try {
        const sessionId = ctx.sessionManager.getSessionId?.() ?? "__default__";
        warnedSessions.delete(sessionId);

        const { tasks, actionableCount, readyTasks } = getTaskState();
        if (actionableCount === 0) return;

        const taskLines = [...tasks.filter((t) => t.status === "in_progress"), ...readyTasks]
          .map((t) => `- [#${t.id}] ${t.text} (${t.status})`)
          .join("\n");

        pi.sendUserMessage(
          `## Context Restored After Compaction\n\nActive tasks:\n${taskLines}\n\nPlease continue working on these tasks.`,
          { deliverAs: "followUp" },
        );
      } catch (err) {
        console.error(`[oh-my-pi context] Failed to restore tasks after compaction: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── session_shutdown: clean up stale session entries ────────────────────
  pi.on(
    "session_shutdown",
    async (_event, ctx) => {
      try {
        const sessionId = ctx.sessionManager.getSessionId?.() ?? "__default__";
        warnedSessions.delete(sessionId);
        compactedSessions.delete(sessionId);
      } catch (err) {
        console.error(`[oh-my-pi context] session_shutdown cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
