/**
 * Custom Compaction Hook — replaces pi's built-in compaction with a structured
 * 7-section prompt ported from oh-my-openagent's compaction-context-injector.
 *
 * Uses the `session_before_compact` event to fully replace the default
 * compaction logic, including the summarization prompt.
 */

import type {
  ExtensionAPI,
  SessionBeforeCompactEvent,
} from "@mariozechner/pi-coding-agent";
import {
  convertToLlm,
  serializeConversation,
} from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";

import type { Task } from "../tools/task.js";

export { buildCompactionPrompt, buildUpdateCompactionPrompt };

// ── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a context summarization assistant. " +
  "Your task is to read a conversation between a user and an AI coding assistant, " +
  "then produce a structured summary following the exact format specified.\n\n" +
  "Do NOT continue the conversation. Do NOT respond to any questions in the conversation. " +
  "ONLY output the structured summary.";

const COMPACTION_PROMPT = `Summarize the conversation above into a structured context summary. You MUST include ALL of the following sections:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Key code snippets, function signatures, or data structures under active development
- **External References**: Documentation URLs, library APIs, or external resources being consulted
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. Explicit Constraints (Verbatim Only)
- Include ONLY constraints explicitly stated by the user or in existing AGENTS.md context
- Quote constraints verbatim (do not paraphrase)
- Do NOT invent, add, or modify constraints
- If no explicit constraints exist, write "None"

## 7. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents (momus, oracle) to maintain continuity.

This context is critical for maintaining continuity after compaction.`;

const UPDATE_COMPACTION_PROMPT =
  "You are updating a previous context summary with new information from the latest conversation segment.\n\n" +
  "RULES:\n" +
  "- PRESERVE all existing information from the previous summary unless explicitly superseded\n" +
  "- ADD new progress, decisions, and context from the new conversation\n" +
  "- UPDATE the progress section to reflect current state\n" +
  "- PRESERVE exact file paths, variable names, and error messages\n" +
  "- Follow the same 7-section structure\n\n" +
  COMPACTION_PROMPT;

// ── File operations (not exported from pi's public API) ──────────────────────

interface FileOps {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

function extractFileOpsFromMessages(
  messages: { role: string; content?: unknown }[],
): FileOps {
  const ops: FileOps = {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (
        typeof block !== "object" ||
        block === null ||
        !("type" in block) ||
        block.type !== "toolCall" ||
        !("arguments" in block) ||
        !("name" in block)
      )
        continue;

      const args = block.arguments as Record<string, unknown> | undefined;
      const path = typeof args?.path === "string" ? args.path : undefined;
      if (!path) continue;

      switch (block.name) {
        case "read":
          ops.read.add(path);
          break;
        case "write":
          ops.written.add(path);
          break;
        case "edit":
          ops.edited.add(path);
          break;
      }
    }
  }

  return ops;
}

function formatFileOps(ops: FileOps): string {
  const modified = new Set([...ops.edited, ...ops.written]);
  const readOnly = [...ops.read].filter((f) => !modified.has(f)).sort();
  const modifiedFiles = [...modified].sort();

  const sections: string[] = [];
  if (readOnly.length > 0) {
    sections.push(`<read-files>\n${readOnly.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(
      `<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`,
    );
  }
  return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

// ── Context injection helpers ────────────────────────────────────────────────

function formatTaskContext(
  getTaskState: () => { tasks: Task[]; pendingCount: number },
): string {
  const { tasks, pendingCount } = getTaskState();
  if (pendingCount === 0) return "";

  const lines = tasks
    .filter((t) => t.status !== "done" && t.status !== "expired")
    .map((t) => `- [#${t.id}] ${t.text} (${t.status})`)
    .join("\n");

  return `\n\n<active-tasks>\n${lines}\n</active-tasks>`;
}

// ── Prompt builders (exported for testing) ───────────────────────────────────

function buildCompactionPrompt(
  conversationText: string,
  taskContext: string,
  customInstructions?: string,
): string {
  let prompt = `<conversation>\n${conversationText}\n</conversation>`;
  prompt += taskContext;
  prompt += `\n\n${COMPACTION_PROMPT}`;
  if (customInstructions) {
    prompt += `\n\nAdditional focus: ${customInstructions}`;
  }
  return prompt;
}

function buildUpdateCompactionPrompt(
  conversationText: string,
  previousSummary: string,
  taskContext: string,
  customInstructions?: string,
): string {
  let prompt = `<conversation>\n${conversationText}\n</conversation>`;
  prompt += `\n\n<previous-summary>\n${previousSummary}\n</previous-summary>`;
  prompt += taskContext;
  prompt += `\n\n${UPDATE_COMPACTION_PROMPT}`;
  if (customInstructions) {
    prompt += `\n\nAdditional focus: ${customInstructions}`;
  }
  return prompt;
}

// ── Hook registration ────────────────────────────────────────────────────────

export function registerCustomCompaction(
  pi: ExtensionAPI,
  getTaskState: () => { tasks: Task[]; pendingCount: number },
): void {
  pi.on(
    "session_before_compact",
    async (event: SessionBeforeCompactEvent, ctx) => {
      ctx.ui.setStatus("omp-compact", "⚡ Compacting (oh-my-pi)...");

      try {
        const model = ctx.model as Model<Api> | undefined;
        if (!model) {
          console.error("[oh-my-pi compact] ctx.model is undefined, falling back to built-in");
          ctx.ui.setStatus("omp-compact", undefined);
          return undefined;
        }

        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok) {
          console.error(`[oh-my-pi compact] auth failed: ${auth.error}, falling back to built-in`);
          ctx.ui.setStatus("omp-compact", undefined);
          return undefined;
        }

        const preparation = event.preparation;
        const reserveTokens = preparation.settings.reserveTokens;
        const maxTokens = Math.floor(0.8 * reserveTokens);

        // Serialize conversation
        const llmMessages = convertToLlm(preparation.messagesToSummarize);
        const conversationText = serializeConversation(llmMessages);

        // Build contextual data
        const taskContext = formatTaskContext(getTaskState);

        // Build prompt
        const hasUpdate = !!preparation.previousSummary;
        const prompt = hasUpdate
          ? buildUpdateCompactionPrompt(
              conversationText,
              preparation.previousSummary!,
              taskContext,
              event.customInstructions,
            )
          : buildCompactionPrompt(
              conversationText,
              taskContext,
              event.customInstructions,
            );

        // Call LLM
        const options: SimpleStreamOptions = {
          maxTokens,
          signal: event.signal,
          apiKey: auth.apiKey,
          headers: auth.headers,
        };

        if (model.reasoning) {
          options.reasoning = "high";
        }

        const response = await completeSimple(
          model,
          {
            systemPrompt: SYSTEM_PROMPT,
            messages: [
              { role: "user" as const, content: prompt, timestamp: Date.now() },
            ],
          },
          options,
        );

        // Extract summary text
        let summary = "";
        for (const block of response.content) {
          if (block.type === "text") {
            summary += block.text;
          }
        }

        if (!summary.trim()) {
          console.error("[oh-my-pi compact] LLM returned empty summary, falling back to built-in");
          ctx.ui.setStatus("omp-compact", undefined);
          return undefined;
        }

        // Append file operation lists
        const fileOps = extractFileOpsFromMessages(
          preparation.messagesToSummarize,
        );
        summary += formatFileOps(fileOps);

        ctx.ui.setStatus("omp-compact", undefined);

        return {
          compaction: {
            summary,
            firstKeptEntryId: preparation.firstKeptEntryId,
            tokensBefore: preparation.tokensBefore,
          },
        };
      } catch (err) {
        console.error("[oh-my-pi compact] error, falling back to built-in:", err);
        ctx.ui.setStatus("omp-compact", undefined);
        return undefined;
      }
    },
  );
}
