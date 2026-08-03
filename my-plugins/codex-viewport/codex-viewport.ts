import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { shouldContainAssistant, type AssistantMessageLike } from "./assistant-containment.js";
import type { CompletionTracker } from "./completion-tracker.js";
import { RuntimeCoordinator } from "./runtime-coordinator.js";

function registerToolCalls(message: AssistantMessageLike, tracker: CompletionTracker<Component>): void {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return;
	for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		const record = block as Record<string, unknown>;
		if (record.type === "toolCall" && typeof record.id === "string") tracker.ensureTool(record.id);
	}
}

function observeAssistant(message: AssistantMessageLike, tracker: CompletionTracker<Component>): void {
	if (shouldContainAssistant(message)) tracker.containCurrentAssistant();
	registerToolCalls(message, tracker);
}

export default function codexViewport(pi: ExtensionAPI): void {
	const runtime = new RuntimeCoordinator();

	pi.on("session_start", (_event, ctx) => {
		runtime.capture(ctx);
	});

	pi.on("agent_start", () => {
		runtime.startRun();
	});

	pi.on("message_start", (event) => {
		if (!runtime.isManaged() || event.message.role !== "assistant") return;
		runtime.tracker.beginAssistant();
		observeAssistant(event.message, runtime.tracker);
	});

	pi.on("message_update", (event) => {
		if (runtime.isManaged()) observeAssistant(event.message, runtime.tracker);
	});

	pi.on("message_end", (event) => {
		if (!runtime.isManaged() || event.message.role !== "assistant") return;
		observeAssistant(event.message, runtime.tracker);
		runtime.tracker.completeAssistant(event.message.stopReason === "aborted" || event.message.stopReason === "error");
	});

	pi.on("tool_execution_start", (event) => {
		if (runtime.isManaged()) runtime.tracker.ensureTool(event.toolCallId);
	});

	pi.on("tool_execution_end", (event) => {
		if (runtime.isManaged()) runtime.tracker.completeTool(event.toolCallId);
	});

	pi.on("agent_end", () => {
		runtime.finishRun();
	});

	pi.on("session_shutdown", () => {
		runtime.shutdown();
	});
}
