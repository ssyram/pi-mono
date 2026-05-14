import { completeSimple } from "@mariozechner/pi-ai";
import type { Context, Message } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { boundLlmInput, formatTruncationNotice, parseMaxChars } from "./bounded-llm-input.js";
import { findFirstKeptEntryId } from "./find-cut-point.js";
import { parseArgs, type KeepRecentOptions } from "./parse-args.js";

interface PendingKeepRecent {
	options: KeepRecentOptions;
}

const pendingBySession = new Map<string, PendingKeepRecent>();

const SUMMARY_PROMPT = `Summarize the following conversation concisely. Focus on:
- Key decisions and outcomes
- Important file changes and their purposes
- Unresolved issues or next steps
Keep it brief but preserve critical context needed to continue the work.`;

export default async function keepRecent(pi: ExtensionAPI): Promise<void> {
	pi.registerFlag("keep-recent-max-summary-chars", {
		type: "string",
		description: "Maximum serialized dropped-message characters sent to /keep-recent summary generation",
		default: "10240",
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const pending = pendingBySession.get(sessionId);
		if (!pending) return {};

		const opts = pending.options;
		const branchEntries = ctx.sessionManager.getBranch();
		const firstKeptId = findFirstKeptEntryId(branchEntries, opts.count, opts.assistantCut);

		if (!firstKeptId) {
			pendingBySession.delete(sessionId);
			ctx.ui.notify(`Not enough turns to keep ${opts.count} — nothing to compact.`, "info");
			return { cancel: true };
		}

		const messagesToDrop = collectMessagesBefore(branchEntries, firstKeptId);

		if (messagesToDrop.length === 0) {
			pendingBySession.delete(sessionId);
			ctx.ui.notify("Nothing to compact — all messages are already within the keep range.", "info");
			return { cancel: true };
		}

		let summary = "";
		if (opts.summary && ctx.model) {
			ctx.ui.notify(`Summarizing ${messagesToDrop.length} dropped messages…`, "info");
			const llmMessages = convertToLlm(messagesToDrop);
			const conversationText = serializeConversation(llmMessages);
			const maxChars = parseMaxChars(pi.getFlag("keep-recent-max-summary-chars"));
			const bounded = boundLlmInput(conversationText, maxChars);
			const summaryText = bounded.truncated
				? `${formatTruncationNotice(bounded.originalLength, maxChars)}\n\n${bounded.text}`
				: bounded.text;

			const userMessage: Message = {
				role: "user",
				content: [{ type: "text", text: summaryText }],
				timestamp: Date.now(),
			};

			const context: Context = {
				systemPrompt: SUMMARY_PROMPT,
				messages: [userMessage],
			};

			try {
				const result = await completeSimple(ctx.model, context, { signal: event.signal });
				const textPart = result.content.find((c) => c.type === "text");
				summary = textPart?.text ?? "";
			} catch (err) {
				ctx.ui.notify(`Summary generation failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
				summary = `[Summary generation failed — ${messagesToDrop.length} messages dropped]`;
			}
		} else {
			summary = `[${messagesToDrop.length} messages dropped without summary]`;
		}

		return {
			compaction: {
				summary,
				firstKeptEntryId: firstKeptId,
				tokensBefore: event.preparation.tokensBefore,
			},
		};
	});

	pi.registerCommand("keep-recent", {
		description: "Compact history, keeping only the N most recent user turns. Usage: /keep-recent [--summary | --no-summary] [--assistant-cut] <N>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let opts: KeepRecentOptions;
			try {
				opts = parseArgs(args);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
				return;
			}

			const sessionId = ctx.sessionManager.getSessionId();
			if (pendingBySession.has(sessionId)) {
				ctx.ui.notify("A keep-recent compaction is already in progress for this session.", "warning");
				return;
			}

			const branchEntries = ctx.sessionManager.getBranch();
			const firstKeptId = findFirstKeptEntryId(branchEntries, opts.count, opts.assistantCut);

			if (!firstKeptId) {
				ctx.ui.notify(`Not enough turns to keep ${opts.count} — nothing to compact.`, "info");
				return;
			}

			const dropCount = collectMessagesBefore(branchEntries, firstKeptId).length;
			const cutLabel = opts.assistantCut ? "assistant" : "user";
			ctx.ui.notify(
				`Keeping last ${opts.count} ${cutLabel} turn(s), dropping ${dropCount} message(s)${opts.summary ? " with summary" : ""}.`,
				"info",
			);

			pendingBySession.set(sessionId, { options: opts });
			ctx.compact({
				onComplete: () => {
					pendingBySession.delete(sessionId);
				},
				onError: () => {
					pendingBySession.delete(sessionId);
				},
			});
		},
	});
}

function collectMessagesBefore(branchEntries: SessionEntry[], firstKeptId: string): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of branchEntries) {
		if (entry.id === firstKeptId) break;
		if (entry.type === "message") {
			messages.push(entry.message);
		}
	}
	return messages;
}
