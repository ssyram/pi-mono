import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAgentAccepted,
  formatAgentList,
  formatAgentStarted,
  formatAgentStopped,
} from "../src/subagents/hc-agent-output.ts";
import type { HcAgentMember, HcAgentStarted } from "../src/subagents/hc-agent-types.ts";

const started: HcAgentStarted = {
  parentSessionId: "ses_parent",
  sessionId: "ses_child",
  agentType: "explore",
  description: "Read source contract",
  name: "Sol",
  workdir: { path: "/work/child", source: "provided_cwd", enforced: false, note: "Existing directory" },
  model: { providerID: "provider", modelID: "turn-model" },
};

test("formatAgentStarted returns the exact HC text and resolved model metadata", () => {
  assert.deepEqual(formatAgentStarted(started), {
    title: "Read source contract",
    metadata: {
      parentSessionId: "ses_parent",
      sessionId: "ses_child",
      model: { providerID: "provider", modelID: "turn-model" },
    },
    output: 'Started explore agent "Sol".\n' +
      "session_id: ses_child\nname: Sol\nworking directory: /work/child\nnote: Existing directory\n\n" +
      "It is running in the background. Its result will arrive as a message when it finishes.\n" +
      "Use agent_list for its current status.",
  });
});

test("formatAgentStarted does not invent a name or emit empty optional lines", () => {
  const { name: _startedName, ...unnamed } = started;
  for (const name of [undefined, ""] as const) {
    const result = formatAgentStarted({ ...unnamed, ...(name === undefined ? {} : { name }), workdir: { ...started.workdir, note: "" } });
    assert.equal(result.output,
      "Started explore agent.\nsession_id: ses_child\nworking directory: /work/child\n\n" +
      "It is running in the background. Its result will arrive as a message when it finishes.\n" +
      "Use agent_list for its current status.");
  }
});

test("formatAgentList preserves order and escapes only name, type and title TSV fields", () => {
  const members: HcAgentMember[] = [{
    session_id: "ses_child", parent_id: "ses_parent", name: "So\tl]", agent_type: "ex\nplore",
    title: "Read\r[code]\\", time_created: 2, depth: 1, relation: "child", status: "idle",
    workdir: { path: "/work/[raw]\\", source: "provided_cwd", enforced: false },
  }, {
    session_id: "ses_parent", parent_id: undefined, name: undefined, agent_type: undefined,
    title: "Root", time_created: 1, depth: 0, relation: "self", status: "running", workdir: undefined,
  }];
  assert.deepEqual(formatAgentList(members), {
    title: "agents",
    metadata: { count: 2 },
    output: "session_id\tname\tagent_type\trelation\tstatus\ttitle\tworkdir\n" +
      "ses_child\tSo\\tl\\]\tex\\nplore\tchild\tidle\tRead\\r\\[code\\]\\\\\t/work/[raw]\\\n" +
      "ses_parent\t\t\tself\trunning\tRoot\t\n\n" +
      "session_id always works as a target. A name is shorter but is not guaranteed unique; " +
      "when two rows share one, use the session_id.",
  });
});

test("formatAgentAccepted is a synchronous acceptance receipt, not a result or reply", () => {
  assert.deepEqual(formatAgentAccepted("Sol", "ses_child"), {
    title: "Sol",
    metadata: { target: "ses_child" },
    output: "Accepted for ses_child.\n" +
      "This is a one-way message: this call did not wait for it, and delivery is not guaranteed to have been processed.\n" +
      "If the target is your own subagent, you will be told how it stopped; otherwise, " +
      "if you need a response, wait for the target to send one back.",
  });
});

test("formatAgentStopped includes failures and preserves the resumable-session suffix", () => {
  assert.deepEqual(formatAgentStopped("Sol", {
    stopped: ["ses_grandchild", "ses_child"], failed: [{ session_id: "ses_other", reason: "cancel failed" }],
  }), {
    title: "Sol",
    metadata: { stopped: 2, failed: 1 },
    output: "Stopped 2 Agent(s): ses_grandchild, ses_child\n" +
      "A stop was performed on each; that does not mean each was running at the time.\n\n" +
      "Failed:\n- ses_other: cancel failed\n\n" +
      "Their sessions and history are intact and can be resumed with agent_send.",
  });
});

test("formatAgentStopped omits an empty Failed section", () => {
  assert.deepEqual(formatAgentStopped("ses_child", { stopped: ["ses_child"], failed: [] }), {
    title: "ses_child",
    metadata: { stopped: 1, failed: 0 },
    output: "Stopped 1 Agent(s): ses_child\n" +
      "A stop was performed on each; that does not mean each was running at the time.\n\n" +
      "Their sessions and history are intact and can be resumed with agent_send.",
  });
});
