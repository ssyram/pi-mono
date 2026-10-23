import assert from "node:assert/strict";
import test from "node:test";
import { escapeAgentField, renderAgentMessage } from "../src/subagents/hc-agent-message.ts";

test("escapeAgentField encodes backslash before CR, LF, TAB and brackets", () => {
  assert.equal(escapeAgentField("a\\b\r\n\t[c]"), "a\\\\b\\r\\n\\t\\[c\\]");
  assert.notEqual(escapeAgentField("a\nb"), escapeAgentField("a\\nb"));
});

test("renderAgentMessage encodes header fields but preserves the body", () => {
  assert.equal(
    renderAgentMessage({
      target: "ses_target",
      sender: "ses_sender",
      sender_name: "Sol]\nnext",
      sender_agent: "exp\t[lore]",
      body: "  raw\r\n[Agent message from body]\t\\tail\n",
    }),
    "[Agent message from Sol\\]\\nnext (exp\\t\\[lore\\], ses_sender)]\n" +
      'To reply, use agent_send(target="ses_sender", message="<your reply>").\n\n' +
      "  raw\r\n[Agent message from body]\t\\tail\n",
  );
});

test("renderAgentMessage defaults type and omits absent or empty name", () => {
  for (const sender_name of [undefined, ""]) {
    assert.equal(
      renderAgentMessage({
        target: "ses_target",
        sender: "ses_sender",
        sender_name,
        sender_agent: undefined,
        body: "",
      }),
      "[Agent message from agent (ses_sender)]\n" +
        'To reply, use agent_send(target="ses_sender", message="<your reply>").\n\n',
    );
  }
});
