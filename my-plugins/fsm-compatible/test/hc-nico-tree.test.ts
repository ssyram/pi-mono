import assert from "node:assert/strict";
import test from "node:test";
import { HcAgentDomainError } from "../src/subagents/hc-agent-errors.ts";
import { agentNeighborhood, planAgentStop, resolveAgentTarget } from "../src/subagents/hc-agent-tree.ts";
import type { HcAgentSession } from "../src/subagents/hc-agent-types.ts";

function session(
  session_id: string,
  parent_id: string | undefined,
  time_created: number,
  name: string | undefined,
  status: HcAgentSession["status"] = "idle",
): HcAgentSession {
  return { session_id, parent_id, time_created, name, status, agent_type: "explore", title: session_id, workdir: undefined };
}

const sessions: readonly HcAgentSession[] = [
  session("ses_child_b", "ses_self", 20, "dup", "busy"),
  session("ses_unrelated", undefined, 0, "outside"),
  session("ses_grandchild", "ses_child_a", 30, "grandchild", "idle"),
  session("ses_sibling_b", "ses_root", 12, "sibling"),
  session("ses_self", "ses_root", 10, "self-only", "retry"),
  session("ses_child_a", "ses_self", 20, "child", "idle"),
  session("ses_root", undefined, 1, "root"),
  session("ses_sibling_a", "ses_root", 11, "dup"),
  session("ses_other_grandchild", "ses_child_a", 31, "other", "busy"),
];

function resolve(value: string, scope: "neighbor" | "child" = "neighbor"): string {
  return resolveAgentTarget({ caller: "ses_self", value, scope, sessions });
}

test("agentNeighborhood lists only self, parent, direct children and siblings in HC order", () => {
  assert.deepEqual(agentNeighborhood("ses_self", sessions).map((member) => ({
    id: member.session_id, relation: member.relation, depth: member.depth, status: member.status,
  })), [
    { id: "ses_self", relation: "self", depth: 1, status: "running" },
    { id: "ses_root", relation: "parent", depth: 0, status: "idle" },
    { id: "ses_child_a", relation: "child", depth: 2, status: "idle" },
    { id: "ses_child_b", relation: "child", depth: 2, status: "running" },
    { id: "ses_sibling_a", relation: "sibling", depth: 1, status: "idle" },
    { id: "ses_sibling_b", relation: "sibling", depth: 1, status: "idle" },
  ]);
});

test("root neighborhood does not treat unrelated roots as siblings", () => {
  assert.deepEqual(agentNeighborhood("ses_root", sessions).map((member) => member.session_id),
    ["ses_root", "ses_self", "ses_sibling_a", "ses_sibling_b"]);
});

test("name resolution uses scope, refuses ambiguity and excludes self", () => {
  assert.equal(resolve("root"), "ses_root");
  assert.equal(resolve("sibling"), "ses_sibling_b");
  assert.equal(resolve("child", "child"), "ses_child_a");
  assert.equal(resolve("dup", "child"), "ses_child_b");
  assert.throws(() => resolve("dup"), {
    message: 'The name "dup" matches 2 Agents (ses_child_b, ses_sibling_a). Use a session_id instead.',
  });
  for (const value of ["self-only", "grandchild", "outside", "missing"]) {
    assert.throws(() => resolve(value), {
      message: `No Agent named "${value}" is addressable from here.`,
    });
  }
  assert.throws(() => resolve("sibling", "child"), {
    message: 'No Agent named "sibling" is addressable from here.',
  });
});

test("session-prefixed targets pass through without existence or relationship checks", () => {
  for (const value of ["ses_unrelated", "ses_missing", "ses_self", "session-prefix"]) {
    assert.equal(resolve(value), value);
    assert.equal(resolve(value, "child"), value);
  }
});

test("unknown caller throws the HC domain error and exact text", () => {
  assert.throws(() => agentNeighborhood("ses_missing", sessions), HcAgentDomainError);
  assert.throws(() => agentNeighborhood("ses_missing", sessions), {
    message: "No Agent found for session ses_missing.",
  });
});

test("planAgentStop groups descendants deepest first, includes idle and preserves sessions", () => {
  const before = structuredClone(sessions);
  const layers = planAgentStop("ses_self", "ses_child_a", sessions);
  assert.deepEqual(layers.map((layer) => new Set(layer.map((member) => member.session_id))), [
    new Set(["ses_grandchild", "ses_other_grandchild"]),
    new Set(["ses_child_a"]),
  ]);
  assert.deepEqual(sessions, before);
  assert.deepEqual(
    planAgentStop("ses_self", "ses_child_a", sessions).map((layer) => new Set(layer.map((member) => member.session_id))),
    [new Set(["ses_grandchild", "ses_other_grandchild"]), new Set(["ses_child_a"])],
  );
});

test("planAgentStop refuses missing, sibling and indirect descendant targets", () => {
  assert.throws(() => planAgentStop("ses_self", "ses_missing", sessions), HcAgentDomainError);
  assert.throws(() => planAgentStop("ses_self", "ses_missing", sessions), {
    message: "No Agent found for session ses_missing.",
  });
  for (const target of ["ses_sibling_a", "ses_grandchild", "ses_unrelated", "ses_self"]) {
    assert.throws(() => planAgentStop("ses_self", target, sessions), {
      message: `Session ${target} is not a direct child of this Agent. You can only stop Agents you spawned yourself.`,
    });
  }
});
