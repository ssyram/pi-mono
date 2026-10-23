export type HcAgentToolName = "agent" | "agent_list" | "agent_send" | "agent_stop";

export type HcAgentRelation = "self" | "parent" | "child" | "sibling";

export type HcAgentStatus = "running" | "idle";

export interface HcAgentModel {
	providerID: string;
	modelID: string;
}

export interface HcAgentWorkdir {
	path: string;
	source: "generated_git_worktree" | "generated_empty_workspace" | "provided_cwd";
	enforced: false;
	note?: string;
}

export interface HcAgentSession {
	session_id: string;
	parent_id: string | undefined;
	name: string | undefined;
	agent_type: string | undefined;
	title: string;
	time_created: number;
	workdir: HcAgentWorkdir | undefined;
	status: "busy" | "retry" | "idle";
}

export interface HcAgentMember extends Omit<HcAgentSession, "status"> {
	depth: number;
	relation: HcAgentRelation;
	status: HcAgentStatus;
}

export interface HcAgentMessage {
	target: string;
	sender: string;
	sender_name: string | undefined;
	sender_agent: string | undefined;
	body: string;
}

export interface HcToolOutput {
	title: string;
	metadata: Record<string, unknown>;
	output: string;
}

export interface HcAgentStarted {
	parentSessionId: string;
	sessionId: string;
	agentType: string;
	description: string;
	name?: string;
	workdir: HcAgentWorkdir;
	model: HcAgentModel;
}

export interface HcStopOutcome {
	stopped: string[];
	failed: { session_id: string; reason: string }[];
}
