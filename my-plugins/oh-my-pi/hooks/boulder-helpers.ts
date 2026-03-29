/**
 * Helper functions for the boulder hook.
 * Message inspection heuristics for restart suppression.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";

import { CONFIRM_STOP_TAG } from "../tools/task.js";

/** Minimum length for an assistant message to NOT be considered aborted */
const ABORT_TEXT_MIN_LENGTH = 20;

/**
 * Find the last assistant message in a message list.
 */
export function findLastAssistant(
  messages: readonly { role: string; content?: unknown }[],
): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AssistantMessage;
    if (m.role === "assistant") return m;
  }
  return undefined;
}

/**
 * Check if the last assistant message contains the CONFIRM_STOP_TAG.
 * Only inspects the last assistant message, not the entire history.
 */
export function hasConfirmStop(
  messages: readonly { role: string; content?: unknown }[],
): boolean {
  const last = findLastAssistant(messages);
  if (!last) return false;
  return last.content.some(
    (c) => c.type === "text" && c.text.includes(CONFIRM_STOP_TAG),
  );
}

/**
 * Check if the last assistant message was aborted by the user.
 * Uses the explicit stopReason field rather than heuristics.
 */
export function wasAborted(
  messages: readonly { role: string; content?: unknown }[],
): boolean {
  const last = findLastAssistant(messages);
  if (!last) return false;
  return last.stopReason === "aborted";
}

/**
 * Heuristic: detect if the last assistant message was likely aborted.
 * An aborted turn typically ends with an extremely short assistant message
 * or an error content block.
 */
export function looksAborted(
  messages: readonly { role: string; content?: unknown }[],
): boolean {
  const last = findLastAssistant(messages);
  if (!last) return false;

  const hasError = last.content.some(
    (c) => c.type === "text" && /\berror\b/i.test(c.text) && c.text.length < ABORT_TEXT_MIN_LENGTH,
  );
  if (hasError) return true;

  const totalText = last.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
  return totalText.length < ABORT_TEXT_MIN_LENGTH && totalText.length > 0;
}

/**
 * Detect if the last assistant message ends with a question or uses a question tool.
 * If so, the agent is waiting for user input and should not be auto-restarted.
 */
export function isAskingQuestion(
  messages: readonly { role: string; content?: unknown }[],
): boolean {
  const last = findLastAssistant(messages);
  if (!last) return false;

  const text = last.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
  if (text.trim().endsWith("?")) return true;

  return last.content.some(
    (c) => c.type === "toolCall" && c.name === "question",
  );
}
