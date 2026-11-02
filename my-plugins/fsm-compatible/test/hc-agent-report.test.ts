import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { classifyFromRun, turnBoundaryReportable } from "../src/subagents/hc-agent-report.ts";
import type { HcSessionRecord } from "../src/subagents/hc-session-record.ts";

function assistant(text: string, id = "call_none"): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }], id, provider: undefined, model: undefined, createdAt: 0 } as never;
}

function toolResult(toolCallId: string, isError: boolean): AgentMessage {
	return { role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: "out" }], isError, timestamp: 0 } as never;
}

function record(overrides: Partial<HcSessionRecord> = {}): HcSessionRecord {
	return { parent_id: "ses_parent", notify: true, turnProfile: undefined, ...overrides } as HcSessionRecord;
}

test("classifyFromRun ignores tool failures outside the final assistant's own calls (OC parity)", () => {
	const messages: AgentMessage[] = [
		assistant("earlier", "m1"),
		toolResult("old_call", true),
		assistant("final answer", "m2"),
	];
	const outcome = classifyFromRun(messages, "ses_child");
	assert.equal(outcome.kind, "completed");
	assert.equal(outcome.text, "final answer");
});

test("classifyFromRun still fails on the final assistant's own errored tool call", () => {
	const messages: AgentMessage[] = [
		{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }], id: "m1", provider: undefined, model: undefined, createdAt: 0 } as never,
		toolResult("c1", true),
		assistant("after", "m2"),
		toolResult("c2", false),
	];
	const finalWithCall: AgentMessage[] = [
		{ role: "assistant", content: [{ type: "toolCall", id: "c2", name: "read", arguments: {} }], id: "m3", provider: undefined, model: undefined, createdAt: 0 } as never,
		toolResult("c2", true),
	];
	const outcome = classifyFromRun([...messages, ...finalWithCall], "ses_child");
	assert.equal(outcome.kind, "failed");
});

test("turnBoundaryReportable fires only for stop-gate-marked turns of notified children", () => {
	assert.equal(turnBoundaryReportable(record({ turnProfile: "build" })), true, "pause-marked boundary reports");
	assert.equal(turnBoundaryReportable(record({})), false, "plain tool turns stay silent");
	assert.equal(turnBoundaryReportable(record({ turnProfile: "build", notify: false })), false, "unnotified children stay silent");
	assert.equal(turnBoundaryReportable(record({ turnProfile: "build", parent_id: undefined })), false, "root turns are not parent reports");
	assert.equal(turnBoundaryReportable(record({ turnProfile: "some-other" })), false, "only the stop-gate marker counts");
});

test("empty-content tool results still count as usable output (OC parity)", () => {
	const pendingAssistant = { role: "assistant", stopReason: "pending", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }], id: "m1" } as never;
	const emptyResult = { role: "toolResult", toolCallId: "c1", toolName: "read", content: [], isError: false, timestamp: 0 } as never;
	const outcome = classifyFromRun([pendingAssistant, emptyResult], "ses_child");
	assert.equal(outcome.kind, "completed", "a finished tool call with empty content is usable output, not IncompleteResponse");
});
