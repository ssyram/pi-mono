import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldContainAssistant } from "./assistant-containment.js";

describe("shouldContainAssistant", () => {
	it("keeps text and tool-call metadata on the native path", () => {
		assert.equal(shouldContainAssistant({ role: "assistant", content: [] }), false);
		assert.equal(shouldContainAssistant({ role: "assistant", content: [{ type: "text", text: "hello" }] }), false);
		assert.equal(
			shouldContainAssistant({
				role: "assistant",
				content: [
					{ type: "text", text: "checking" },
					{ type: "toolCall", id: "call", name: "read", arguments: {} },
				],
			}),
			false,
		);
	});

	it("contains thinking and unknown dynamic blocks", () => {
		assert.equal(shouldContainAssistant({ role: "assistant", content: [{ type: "thinking", thinking: "work" }] }), true);
		assert.equal(shouldContainAssistant({ role: "assistant", content: [{ type: "future" }] }), true);
		assert.equal(shouldContainAssistant({ role: "assistant", content: ["invalid"] }), true);
	});

	it("ignores non-assistant messages", () => {
		assert.equal(shouldContainAssistant({ role: "user", content: [{ type: "thinking" }] }), false);
	});
});
