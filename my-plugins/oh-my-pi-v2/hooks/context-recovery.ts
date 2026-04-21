/**
 * Context Recovery Hook - Monitors context usage and manages compaction.
 *
 * - 70%: injects a reminder that context is filling but still has room.
 * - 78%: triggers automatic compaction (once per session).
 * - After compaction: injects pending task list so the model does not lose track.
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

/** Sessions that already triggered auto-compaction. */
const compactedSessions = new Set<string>();

export function registerContextRecovery(
  pi: ExtensionAPI,
  getTaskState: () => { tasks: Task[]; pendingCount: number },
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
          compactedSessions.add(sessionId);
          ctx.compact();
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
      } catch {
        // Hooks must never throw
        return undefined;
      }
    },
  );

  // ── session_compact: restore pending tasks after compaction ──────────────
  pi.on(
    "session_compact",
    async (_event: SessionCompactEvent, ctx) => {
      try {
        const sessionId = ctx.sessionManager.getSessionId?.() ?? "__default__";
        warnedSessions.delete(sessionId);
        compactedSessions.delete(sessionId);

        const { tasks, pendingCount } = getTaskState();
        if (pendingCount === 0) return;

        const taskLines = tasks
          .filter((t) => t.status !== "done" && t.status !== "expired")
          .map((t) => `- [#${t.id}] ${t.text} (${t.status})`)
          .join("\n");

        pi.sendUserMessage(
          `## Context Restored After Compaction\n\nActive tasks:\n${taskLines}\n\nPlease continue working on these tasks.`,
          { deliverAs: "followUp" },
        );
      } catch {
        // Hooks must never throw
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
      } catch {
        // Hooks must never throw
      }
    },
  );
}
