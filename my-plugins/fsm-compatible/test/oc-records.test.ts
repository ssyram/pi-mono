import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, ToolResultMessage, UserMessage, Usage } from "@earendil-works/pi-ai";
import type { PersistedBinding } from "../src/binding/actor-binding.ts";
import { projectOcMessages } from "../src/records/oc-messages.ts";
import { normalizeIsoTimestamp } from "../src/records/record-time.ts";
import { RecordStore } from "../src/records/record-store.ts";
import type { ExecutionRecord, RecordFacts } from "../src/records/session-record.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function rootBinding(sessionId: string): PersistedBinding {
	return { version: 1, rootSessionId: sessionId, sessionId, parentSessionId: null, agentId: "main",
		kind: "execution-root", agentName: null, bootstrapRef: null, requiredExtensions: [] };
}

function user(text: string): UserMessage { return { role: "user", content: text, timestamp: Date.now() }; }

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return { role: "assistant", content, api: "anthropic" as never, provider: "anthropic" as never,
		model: "claude-test", usage, stopReason, timestamp: Date.now() };
}

function toolResult(toolCallId: string, toolName: string, text: string, isError = false): ToolResultMessage {
	return { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: Date.now() };
}

function facts(sm: SessionManager, lifecycle: RecordFacts["lifecycle"] = "running"): RecordFacts {
	return { title: "main", lifecycle, updatedAt: Date.now(), header: sm.getHeader(), branch: sm.getBranch(),
		sessionFile: null, errorMessage: null };
}

function execution(store: RecordStore, binding: PersistedBinding): ExecutionRecord {
	const record = store.getExecution(binding.sessionId);
	assert.ok(record);
	return record;
}

test("ISO normalization accepts only canonical persisted shapes and rejects guesswork", () => {
	const canonical = "2026-10-14T09:00:00.000Z";
	assert.equal(normalizeIsoTimestamp(canonical), Date.parse(canonical));
	for (const bad of ["2026-10-14T09:00:00Z", "not-a-date", "2026-10-14T09:00:00.000Z ", "", "9999-99-99T00:00:00.000Z"]) {
		assert.throws(() => normalizeIsoTimestamp(bad), { code: "protocol-invalid" });
	}
});

test("user/assistant/tool projection keeps real identities, results and completion order", () => {
	const sm = SessionManager.inMemory("/work", { id: "root-1" });
	sm.appendMessage(user("hello"));
	sm.appendMessage(assistant([{ type: "text", text: "running" },
		{ type: "thinking", thinking: "considering" },
		{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/a" } }], "toolUse"));
	sm.appendMessage(toolResult("call-1", "read", "file body"));
	sm.appendMessage(assistant([{ type: "text", text: "done" }]));
	const binding = rootBinding("root-1");
	const store = new RecordStore(binding);
	store.publishExecution(binding, facts(sm));
	const messages = projectOcMessages(execution(store, binding));
	const allPartIds = messages.flatMap((message) => message.parts.map((part) => part.id));
	assert.equal(new Set(allPartIds).size, allPartIds.length, "part ids must be unique within and across envelopes");
	assert.equal(messages.length, 3);
	assert.deepEqual(messages.map((message) => message.info.role), ["user", "assistant", "assistant"]);
	const [first, tools, last] = messages;
	assert.ok(first?.info.id.startsWith("msg_"));
	const toolPart = tools?.parts.find((part) => part.type === "tool");
	assert.equal(toolPart && toolPart.type === "tool" ? toolPart.tool : undefined, "read");
	assert.equal(toolPart && toolPart.type === "tool" ? toolPart.state.status : undefined, "completed");
	assert.equal(toolPart && toolPart.type === "tool" ? toolPart.state.output : undefined, "file body");
	assert.ok(tools?.info.time.completed !== undefined && tools.info.time.completed >= tools.info.time.created);
	assert.equal(tools?.info.finish, "tool-calls");
	assert.equal(last?.info.finish, "stop");
	assert.ok(tools?.parts.some((part) => part.type === "reasoning"));
	assert.equal(toolPart?.metadata?.pi?.startIsObservation, true);
});

test("unresolved calls stay running without fabricated completion", () => {
	const sm = SessionManager.inMemory("/work", { id: "root-2" });
	sm.appendMessage(assistant([{ type: "toolCall", id: "call-x", name: "bash", arguments: { command: "sleep" } }], "toolUse"));
	const binding = rootBinding("root-2");
	const store = new RecordStore(binding);
	store.publishExecution(binding, facts(sm));
	const [message] = projectOcMessages(execution(store, binding));
	const part = message?.parts[0];
	assert.ok(part?.type === "tool");
	assert.equal(part.state.status, "running");
	assert.equal(part.state.time.end, undefined);
	assert.equal(message?.info.time.completed, undefined);
});

test("orphan result, duplicate call, tool-name mismatch and bad timestamps reject the whole snapshot", () => {
	const orphan = SessionManager.inMemory("/work", { id: "root-3" });
	orphan.appendMessage(toolResult("ghost", "read", "x"));
	const orphanBinding = rootBinding("root-3");
	const orphanStore = new RecordStore(orphanBinding);
	orphanStore.publishExecution(orphanBinding, facts(orphan));
	assert.throws(() => projectOcMessages(execution(orphanStore, orphanBinding)), { code: "protocol-invalid" });

	const duplicate = SessionManager.inMemory("/work", { id: "root-4" });
	const block = { type: "toolCall" as const, id: "dup", name: "read", arguments: {} };
	duplicate.appendMessage(assistant([block, block], "toolUse"));
	const duplicateBinding = rootBinding("root-4");
	const duplicateStore = new RecordStore(duplicateBinding);
	duplicateStore.publishExecution(duplicateBinding, facts(duplicate));
	assert.throws(() => projectOcMessages(execution(duplicateStore, duplicateBinding)), { code: "protocol-invalid" });

	const mismatch = SessionManager.inMemory("/work", { id: "root-5" });
	mismatch.appendMessage(assistant([{ type: "toolCall", id: "call-m", name: "read", arguments: {} }], "toolUse"));
	mismatch.appendMessage(toolResult("call-m", "write", "x"));
	const mismatchBinding = rootBinding("root-5");
	const mismatchStore = new RecordStore(mismatchBinding);
	mismatchStore.publishExecution(mismatchBinding, facts(mismatch));
	assert.throws(() => projectOcMessages(execution(mismatchStore, mismatchBinding)), { code: "protocol-invalid" });

	const badTime = SessionManager.inMemory("/work", { id: "root-6" });
	badTime.appendMessage({ role: "user", content: "x", timestamp: -5 } as unknown as UserMessage);
	const badBinding = rootBinding("root-6");
	const badStore = new RecordStore(badBinding);
	badStore.publishExecution(badBinding, facts(badStore === badStore ? badTime : badTime));
	assert.throws(() => projectOcMessages(execution(badStore, badBinding)), { code: "protocol-invalid" });
});

test("compaction and custom messages keep raw history in the branch projection", () => {
	const sm = SessionManager.inMemory("/work", { id: "root-7" });
	sm.appendMessage(user("first"));
	sm.appendMessage(assistant([{ type: "text", text: "answer" }]));
	sm.appendCompaction("summary", null, 10);
	sm.appendCustomMessageEntry("fsm-compatible:stop", "continue: blocked", true);
	const binding = rootBinding("root-7");
	const store = new RecordStore(binding);
	store.publishExecution(binding, facts(sm));
	const messages = projectOcMessages(execution(store, binding));
	assert.equal(messages.length, 3);
	assert.deepEqual(messages.map((message) => message.metadata?.pi?.customType), [undefined, undefined, "fsm-compatible:stop"]);
	assert.equal(sm.buildContextEntries().length < sm.getBranch().length, true);
});

test("stop errors project named errors and keep the trace", () => {
	const sm = SessionManager.inMemory("/work", { id: "root-8" });
	sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "partial" }],
		api: "anthropic" as never, provider: "anthropic" as never, model: "claude-test", usage,
		stopReason: "length", timestamp: Date.now() } as AssistantMessage);
	const binding = rootBinding("root-8");
	const store = new RecordStore(binding);
	store.publishExecution(binding, facts(sm));
	const [message] = projectOcMessages(execution(store, binding));
	assert.equal(message?.info.error?.name, "MessageOutputLengthError");
	assert.equal(message?.info.finish, "length");
});

test("store rejects cross-root bindings, reserved ids and judge updates for unknown sessions", () => {
	const store = new RecordStore(rootBinding("root-a"));
	assert.throws(() => store.publishExecution(rootBinding("other"), facts(SessionManager.inMemory("/work", { id: "other" }))), { code: "protocol-invalid" });
	assert.throws(() => store.registerJudge({ sessionId: "", title: "fsm-gate", createdAt: 1, updatedAt: 1, sessionFile: null, lifecycle: "busy" }), { code: "protocol-invalid" });
	assert.throws(() => store.updateJudge("missing", "idle", Date.now()), { code: "not-ready" });
});
