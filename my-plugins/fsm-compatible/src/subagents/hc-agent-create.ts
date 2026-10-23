import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { admitChildLaunch } from "../admission/admit-child-launch.ts";
import { createChildBinding } from "../binding/create-child-binding.ts";
import { HcAgentDomainError } from "./hc-agent-errors.ts";
import { escapeAgentField } from "./hc-agent-message.ts";
import { agentNeighborhood } from "./hc-agent-tree.ts";
import { selectAgentModel } from "./hc-agent-model.ts";
import type { HcAgentModel, HcAgentStarted } from "./hc-agent-types.ts";
import { findHcAgentDefinition, hcAgentAvailableNames } from "./hc-agent-definitions.ts";
import { prepareAgentWorkdir } from "./hc-agent-workdir.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";

export interface HcAgentCreateInput {
	readonly caller: string;
	readonly description: string;
	readonly prompt: string;
	readonly subagent_type: string;
	readonly name: string | undefined;
	readonly cwd: string | undefined;
	readonly callerModel: HcAgentModel;
	readonly callerVariant: string;
}

function workdirInstruction(workdir: { path: string; source: string }, sourceDirectory: string): string {
	return workdir.source === "generated_empty_workspace"
		? [
				`Source directory: ${sourceDirectory}`,
				`Your workspace: ${workdir.path}`,
				"The workspace is initially empty.",
				"Copy only the files you need and use absolute paths for all operations.",
			].join("\n")
		: [
				`Your working directory: ${workdir.path}`,
				"Use absolute paths for all file operations and pass workdir explicitly to shell commands.",
			].join("\n");
}

/** Opening snapshot: parent line plus running siblings, newest first, capped at HC ROSTER_MAX_ROWS. */
export function hcSiblingSnapshot(services: HcAgentRuntimeServices, caller: HcSessionRecord, childId: string): string {
	const members = agentNeighborhood(caller.session_id, services.directory.toAgentSessions())
		.filter((member) => member.relation === "child" && member.session_id !== childId && member.status === "running")
		.toSorted((left, right) => right.time_created - left.time_created);
	const shown = members.slice(0, 10);
	const omitted = members.length - shown.length;
	const callerName = caller.name !== undefined ? `${escapeAgentField(caller.name)}  ` : undefined;
	const parent = `Your parent: ${caller.session_id}  ${callerName ?? ""}— ${escapeAgentField(caller.title)}`;
	const rows = shown.map((item) => {
		const name = item.name ? `${escapeAgentField(item.name)}  ` : "";
		return `  ${item.session_id}  ${name}— ${escapeAgentField(item.title)}`;
	});
	return [
		parent,
		...(rows.length > 0 ? ["", "Working alongside you right now:", ...rows, ...(omitted > 0 ? [`  ${omitted} more are running.`] : [])] : []),
		"",
		"Not everyone you can reach, and not current past this moment.",
	].join("\n");
}

function checkName(services: HcAgentRuntimeServices, caller: HcSessionRecord, name: string): void {
	if (name.startsWith("ses")) throw HcAgentDomainError.nameReservedPrefix(name);
	const root = services.directory.get(services.root.rootSessionId);
	const taken = new Set<string>();
	if (root.name !== undefined) taken.add(root.name);
	for (const record of services.directory.descendants(services.root.rootSessionId)) {
		if (record.name !== undefined) taken.add(record.name);
	}
	if (taken.has(name)) throw HcAgentDomainError.nameTaken(name);
	void caller;
}

/** HC AgentLifecycle.create: checks before resources, identity persisted before the first background run. */
export async function createHcAgent(services: HcAgentRuntimeServices, input: HcAgentCreateInput): Promise<HcAgentStarted> {
	const caller = services.directory.get(input.caller);
	if (caller.depth >= services.subagentDepth) {
		throw HcAgentDomainError.depthLimitReached(caller.depth, services.subagentDepth);
	}
	if (input.name) checkName(services, caller, input.name);
	const definition = findHcAgentDefinition(services.catalog, input.subagent_type);
	if (!definition) {
		throw HcAgentDomainError.agentTypeNotFound(input.subagent_type, hcAgentAvailableNames(services.catalog));
	}
	const admitted = admitChildLaunch(
		services.policy,
		{ rootSessionId: services.root.rootSessionId, sessionId: caller.session_id },
		{ agentName: definition.name, executionMode: "async" },
		services.directory,
		{ availableToolNames: [], requiredToolNames: [] },
	);
	if (!admitted.ok) throw new Error(`FSM admission rejected the agent launch: ${admitted.code}`);
	const model = selectAgentModel(input.callerModel, definition.model ?? undefined);
	const variant = definition.model ? "default" : input.callerVariant || "default";
	const workdir = await prepareAgentWorkdir({
		instanceDirectory: services.instanceDirectory,
		...(input.cwd ? { cwd: input.cwd } : {}),
		...(caller.workdir ? { parentWorkdir: caller.workdir } : {}),
	});
	const sessionId = `ses_${randomBytes(12).toString("hex")}`;
	const binding = createChildBinding(services.root.rootSessionId, sessionId, definition.name, services.policy, caller.session_id);
	const sessionFile = join(services.stateDirectory, sessionId, "session.jsonl");
	const record: HcSessionRecord = {
		session_id: sessionId,
		parent_id: caller.session_id,
		name: input.name || undefined,
		agent_type: definition.name,
		title: `${input.description} (@${definition.name} subagent)`,
		time_created: Date.now(),
		workdir,
		binding,
		model,
		variant,
		description: input.description,
		notify: true,
		depth: caller.depth + 1,
		sessionFile,
		hostSessionId: undefined,
		handle: undefined,
		status: "idle",
		lastRunMessages: undefined,
		lastOutcome: undefined,
	};
	services.directory.putCreated(record, services.persist);
	await services.acquireActor(sessionId);
	const snapshot = hcSiblingSnapshot(services, caller, sessionId);
	const firstPrompt = [workdirInstruction(workdir, services.instanceDirectory), snapshot, input.prompt].join("\n\n");
	const child = await services.host.open(record, services.launchPlan(record), services.observe);
	if (!child.sessionFile || child.sessionFile !== sessionFile) {
		throw new Error("hc child session file mismatch");
	}
	record.hostSessionId = child.sessionId;
	await services.host.deliver(record, firstPrompt);
	return {
		parentSessionId: caller.session_id,
		sessionId,
		agentType: definition.name,
		description: input.description,
		...(input.name ? { name: input.name } : {}),
		workdir,
		model,
	};
}
