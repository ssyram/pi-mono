import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { serializeConversation } from "../../../packages/coding-agent/src/core/compaction/utils.js";
import { convertToLlm } from "../../../packages/coding-agent/src/core/messages.js";
import {
	renderCompactionReferenceSummary,
	serializeCompactionReferenceConversation,
} from "../hooks/annotate-compaction-references.js";
import { expandCompactionReferences } from "../hooks/compaction-reference-codec.js";
import { buildCompactionReferenceState } from "../hooks/compaction-reference-state.js";
import { assistant, tool, user } from "./compaction-reference-fixtures.js";

function native(messages: AgentMessage[]): string {
	return serializeConversation(convertToLlm(messages));
}

function removeTemporaryView(text: string): string {
	return expandCompactionReferences(
		buildCompactionReferenceState([]),
		text.replace(/@!(?:[1-9]\d*)?@/g, ""),
	);
}

describe("compaction reference native composition", () => {
	it("preserves actual batch projection for every original role and excluded/empty content", () => {
		const mixed = user([
			{ type: "text", text: "mixed @!90@" },
			{ type: "image", data: "AA==", mimeType: "image/png" },
		]);
		const messages: AgentMessage[] = [
			user("request [User]: @!90@"),
			user([
				{ type: "text", text: "left@" },
				{ type: "text", text: "!90@right" },
			]),
			user(""),
			user([]),
			mixed,
			user([{ type: "image", data: "AA==", mimeType: "image/png" }]),
			assistant([
				{ type: "text", text: "answer @!90@" },
				{ type: "thinking", thinking: "thought @|!90@" },
				{ type: "text", text: "second" },
				{
					type: "toolCall",
					id: "call",
					name: "read@!91@",
					arguments: { path: "@!92@", nested: { key: "@|!9@" } },
				},
			]),
			assistant([{ type: "text", text: "" }]),
			tool("@!90@".repeat(600)),
			tool(""),
			tool(`${"x".repeat(1999)}😀end`),
			{
				role: "custom",
				customType: "other",
				content: "custom @!90@",
				display: false,
				timestamp: 0,
			},
			{
				role: "bashExecution",
				command: "echo @!90@",
				output: "@|!90@",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 0,
			},
			{
				role: "bashExecution",
				command: "hidden",
				output: "hidden",
				excludeFromContext: true,
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 0,
			},
			{
				role: "branchSummary",
				summary: "branch @!90@",
				fromId: "old",
				timestamp: 0,
			},
			{
				role: "compactionSummary",
				summary: "compact @!90@",
				tokensBefore: 0,
				timestamp: 0,
			},
		];
		const before = JSON.stringify(messages);
		const state = buildCompactionReferenceState(messages);
		assert.equal(state.sources.length, 2);
		assert.equal(
			messages
				.map((m) => native([m]))
				.filter(Boolean)
				.join("\n\n"),
			native(messages),
		);
		const annotated = serializeCompactionReferenceConversation(
			messages,
			state,
			native,
		);
		assert.equal(removeTemporaryView(annotated), native(messages));
		assert.equal(JSON.stringify(messages), before);
		assert.match(annotated, /\[User\]: @!1@request/);
		assert.match(annotated, /\[User\]: mixed @\|!90@/);
		assert.match(annotated, /path="@\|!92@"/);
		assert.match(annotated, /1000 more characters truncated/);
		assert.doesNotMatch(annotated, /hidden/);
	});

	it("keeps one whole source for repeated user occurrences and does not duplicate a catalog", () => {
		const message = user("distinctive request");
		const messages = [message, message];
		const state = buildCompactionReferenceState(
			messages,
			"old distinctive summary",
		);
		const conversation = serializeCompactionReferenceConversation(
			messages,
			state,
			native,
		);
		assert.equal(
			conversation,
			"[User]: @!2@distinctive request@!@\n\n[User]: @!3@distinctive request@!@",
		);
		assert.equal(
			renderCompactionReferenceSummary(state),
			"@!1@old distinctive summary@!@",
		);
		assert.equal(state.sources[1].document, 1);
		assert.equal(state.sources[2].document, 2);
	});

	it("runs two synthetic compactions using only expanded prior text and current users", () => {
		const first = buildCompactionReferenceState([
			user("discard"),
			user("keep exact @!literal@\r\n"),
		]);
		const saved = expandCompactionReferences(
			first,
			"Principle: keep it simple.\n@!2@",
		);
		const suffix = "\n\n<modified-files>\nfile@!999@\n</modified-files>";
		const second = buildCompactionReferenceState(
			[user("next request")],
			saved + suffix,
		);
		assert.equal(second.sources.length, 2);
		assert.equal(second.sources[0].text, saved);
		assert.equal(
			removeTemporaryView(renderCompactionReferenceSummary(second)),
			saved + suffix,
		);
		assert.equal(
			expandCompactionReferences(second, "@!1@\n@!2@"),
			`${saved}\nnext request`,
		);
		assert.equal(expandCompactionReferences(first, "@!1@"), "discard");
		assert.deepEqual(Object.keys(second).sort(), [
			"fileSuffix",
			"sources",
			"summarySourceCount",
			"userOrdinals",
		]);
	});

	it("reconstructs generated native conversations after removing only temporary display syntax", () => {
		for (let seed = 0; seed < 120; seed++) {
			const text = ` 😀@${"|".repeat(seed % 20)}!${seed}@\r\n \t`;
			const messages = [
				tool(text.repeat(seed + 1)),
				user(text),
				assistant([{ type: "text", text }]),
				user(""),
			];
			const state = buildCompactionReferenceState(
				messages,
				text.repeat(seed + 1),
			);
			assert.equal(
				removeTemporaryView(
					serializeCompactionReferenceConversation(messages, state, native),
				),
				native(messages),
			);
			assert.equal(
				removeTemporaryView(renderCompactionReferenceSummary(state)),
				text.repeat(seed + 1),
			);
		}
	});
});
