import { escapeAgentField } from "./hc-agent-message.ts";
import type { HcAgentMember, HcAgentStarted, HcStopOutcome, HcToolOutput } from "./hc-agent-types.ts";

export function formatAgentStarted(info: HcAgentStarted): HcToolOutput {
	const lines: string[] = [
		`Started ${info.agentType} agent${info.name ? ` "${info.name}"` : ""}.`,
		`session_id: ${info.sessionId}`,
	];
	if (info.name) {
		lines.push(`name: ${info.name}`);
	}
	lines.push(`working directory: ${info.workdir.path}`);
	if (info.workdir.note) {
		lines.push(`note: ${info.workdir.note}`);
	}
	lines.push(
		"",
		"It is running in the background. Its result will arrive as a message when it finishes.",
		"Use agent_list for its current status.",
	);
	return {
		title: info.description,
		metadata: { parentSessionId: info.parentSessionId, sessionId: info.sessionId, model: info.model },
		output: lines.join("\n"),
	};
}

export function formatAgentList(members: readonly HcAgentMember[]): HcToolOutput {
	const lines: string[] = ["session_id\tname\tagent_type\trelation\tstatus\ttitle\tworkdir"];
	for (const member of members) {
		lines.push(
			[
				member.session_id,
				escapeAgentField(member.name ?? ""),
				escapeAgentField(member.agent_type ?? ""),
				member.relation,
				member.status,
				escapeAgentField(member.title),
				member.workdir?.path ?? "",
			].join("\t"),
		);
	}
	lines.push(
		"",
		"session_id always works as a target. A name is shorter but is not guaranteed unique; when two rows share one, use the session_id.",
	);
	return {
		title: "agents",
		metadata: { count: members.length },
		output: lines.join("\n"),
	};
}

export function formatAgentAccepted(titleTarget: string, targetSessionId: string): HcToolOutput {
	return {
		title: titleTarget,
		metadata: { target: targetSessionId },
		output: [
			`Accepted for ${targetSessionId}.`,
			"This is a one-way message: this call did not wait for it, and delivery is not guaranteed to have been processed.",
			"If the target is your own subagent, you will be told how it stopped; otherwise, if you need a response, wait for the target to send one back.",
		].join("\n"),
	};
}

export function formatAgentStopped(titleTarget: string, outcome: HcStopOutcome): HcToolOutput {
	const lines: string[] = [
		`Stopped ${outcome.stopped.length} Agent(s): ${outcome.stopped.join(", ")}`,
		"A stop was performed on each; that does not mean each was running at the time.",
	];
	if (outcome.failed.length > 0) {
		lines.push("", "Failed:");
		for (const item of outcome.failed) {
			lines.push(`- ${item.session_id}: ${item.reason}`);
		}
	}
	lines.push("", "Their sessions and history are intact and can be resumed with agent_send.");
	return {
		title: titleTarget,
		metadata: { stopped: outcome.stopped.length, failed: outcome.failed.length },
		output: lines.join("\n"),
	};
}
