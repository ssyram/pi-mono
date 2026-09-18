import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	renderCompactionReferenceSummary,
	serializeCompactionReferenceConversation,
} from "../hooks/annotate-compaction-references.js";
import { escapeCompactionReferenceLiterals } from "../hooks/compaction-reference-codec.js";
import { buildCompactionReferenceState } from "../hooks/compaction-reference-state.js";
import { user } from "./compaction-reference-fixtures.js";

function serialize(messages: AgentMessage[]): string {
	return messages
		.map((m) => (m.role === "user" ? `[User]: ${m.content}` : ""))
		.filter(Boolean)
		.join("\n\n");
}

describe("compaction reference annotation", () => {
	it("annotates summary body in place, then ends before escaped file suffix", () => {
		const suffix = "\n\n<modified-files>\npath@!999@\n</modified-files>";
		const body = "summary @!9@\r\n ";
		const state = buildCompactionReferenceState([user("new")], body + suffix);
		assert.equal(
			renderCompactionReferenceSummary(state),
			`@!1@${escapeCompactionReferenceLiterals(body)}@!@${escapeCompactionReferenceLiterals(suffix)}`,
		);
		assert.equal(
			renderCompactionReferenceSummary(
				buildCompactionReferenceState([], suffix),
			),
			escapeCompactionReferenceLiterals(suffix),
		);
		assert.equal(
			renderCompactionReferenceSummary(buildCompactionReferenceState([])),
			"",
		);
	});

	it("adds only original-position user markers and preserves input objects", () => {
		const message = user("source @!2@\r\n ");
		const messages = [message, message];
		const before = JSON.stringify(messages);
		const state = buildCompactionReferenceState(messages);
		assert.equal(
			serializeCompactionReferenceConversation(messages, state, serialize),
			"[User]: @!1@source @|!2@\r\n @!@\n\n[User]: @!2@source @|!2@\r\n @!@",
		);
		assert.equal(JSON.stringify(messages), before);
		assert.equal(messages[0], messages[1]);
	});

	it("checks the native callback and message alignment caller contracts", () => {
		const messages = [user("text")];
		const state = buildCompactionReferenceState(messages);
		assert.throws(
			() => serializeCompactionReferenceConversation([], state, serialize),
			/occurrence mismatch/,
		);
		assert.throws(
			() =>
				serializeCompactionReferenceConversation(
					messages,
					state,
					() => "changed",
				),
			/native user/,
		);
	});
});
