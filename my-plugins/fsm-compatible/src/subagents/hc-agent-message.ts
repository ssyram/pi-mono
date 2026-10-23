import type { HcAgentMessage } from "./hc-agent-types.ts";

const FIELD_ESCAPES: readonly [string, string][] = [
	["\\", "\\\\"],
	["\r", "\\r"],
	["\n", "\\n"],
	["\t", "\\t"],
	["[", "\\["],
	["]", "\\]"],
];

export function escapeAgentField(value: string): string {
	let escaped = value;
	for (const [from, to] of FIELD_ESCAPES) {
		escaped = escaped.replaceAll(from, to);
	}
	return escaped;
}

export function renderAgentMessage(message: HcAgentMessage): string {
	const agent = escapeAgentField(message.sender_agent ?? "agent");
	const who = message.sender_name
		? `${escapeAgentField(message.sender_name)} (${agent}, ${message.sender})`
		: `${agent} (${message.sender})`;
	return [
		`[Agent message from ${who}]`,
		`To reply, use agent_send(target="${message.sender}", message="<your reply>").`,
		"",
		message.body,
	].join("\n");
}
