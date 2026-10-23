import assert from "node:assert/strict";
import test from "node:test";
import { selectAgentModel } from "../src/subagents/hc-agent-model.ts";
import { availableAgentTools, HC_AGENT_TOOL_NAMES } from "../src/subagents/hc-agent-toolset.ts";

test("selectAgentModel inherits the caller turn model unless the child pins a model", () => {
  const caller = { providerID: "caller-provider", modelID: "active-turn-model" };
  const pinned = { providerID: "child-provider", modelID: "fixed-child-model" };
  assert.deepEqual(selectAgentModel(caller), caller);
  assert.deepEqual(selectAgentModel(caller, pinned), pinned);
});

test("HC tool names and order are exactly the four native tools", () => {
  assert.deepEqual(HC_AGENT_TOOL_NAMES, ["agent", "agent_list", "agent_send", "agent_stop"]);
});

test("default depth limit is three, withdrawing spawn and stop but retaining list and send", () => {
  for (const depth of [0, 1, 2]) {
    assert.deepEqual(availableAgentTools(depth), ["agent", "agent_list", "agent_send", "agent_stop"]);
  }
  for (const depth of [3, 4]) {
    assert.deepEqual(availableAgentTools(depth), ["agent_list", "agent_send"]);
  }
});

test("an explicit depth limit applies at the boundary, including a zero limit", () => {
  assert.deepEqual(availableAgentTools(0, 0), ["agent_list", "agent_send"]);
  assert.deepEqual(availableAgentTools(3, 4), ["agent", "agent_list", "agent_send", "agent_stop"]);
  assert.deepEqual(availableAgentTools(4, 4), ["agent_list", "agent_send"]);
});
