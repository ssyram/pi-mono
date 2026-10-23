import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { HcAgentDomainError } from "./hc-agent-errors.ts";
import { hcAgentDescriptionLines } from "./hc-agent-definitions.ts";
import { agentNeighborhood } from "./hc-agent-tree.ts";
import { formatAgentAccepted, formatAgentList, formatAgentStarted, formatAgentStopped } from "./hc-agent-output.ts";
import { availableAgentTools } from "./hc-agent-toolset.ts";
import type { HcAgentToolName } from "./hc-agent-types.ts";
import type { HcAgentModel, HcToolOutput } from "./hc-agent-types.ts";
import { createHcAgent } from "./hc-agent-create.ts";
import { sendHcAgent } from "./hc-agent-send.ts";
import { stopHcAgent } from "./hc-agent-stop.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";

const AGENT_DESCRIPTION = [
	"- Starts a subagent: a session of its own that runs the task you give it",
	"- The session outlives the run. When the run ends the subagent is idle, with its context and working directory kept",
	"- agent_send talks to it — more work, a correction, a question. While it is idle the message starts its next run; while it is busy it reads the message at its next step, inside the run it is in. This is also how an old one is woken, whether it went idle, was stopped, or was cut off mid-work: it picks up where it left off",
	"- agent_stop stops its current run and those of its descendants. The session stays, and agent_send resumes it",
	"- Always asynchronous: this returns once the subagent has started. Every run ends with a report to you as a message in your conversation; there is nothing to poll",
	"- Several can run at the same time",
	"- When `cwd` is omitted a new working directory is created and the subagent is told to use it, which keeps parallel edits apart. This is a convention, not a sandbox: a shared `cwd`, or an absolute path into the rest of the project, can still collide",
	"- To continue work in an existing directory or worktree, pass that path as `cwd`. Naming it only in the prompt is not enough: a fresh directory is created regardless and the Agent is told to use that one, so the two instructions conflict",
	"- The returned `session_id` always works as a target for agent_send and agent_stop",
	"- `name` is optional and shorter to use, but is not guaranteed unique; if two subagents share one, that name is refused and you must use the session_id",
	"- Nesting is bounded: a subagent deep enough in the tree is not offered this tool at all",
].join("\n");

const LIST_DESCRIPTION = [
	"- Lists the agents you can address: yourself, your parent, your direct children and your siblings",
	"- Does not list grandchildren, or agents belonging to an unrelated conversation",
	"- Every row carries a session_id, which always works as a target; a row may also carry a name, which is shorter but only unique by convention — when two rows share one, use the session_id",
	"- Status is `running` or `idle`, read at this instant. `idle` is a subagent between runs: it keeps its session, context and directory, and a message to it starts its next run; a message to a `running` one is read at its next step. It is a snapshot, not a promise: one shown as running may finish immediately after",
	"- Status never says how an agent finished; that arrives as a message",
].join("\n");

const SEND_DESCRIPTION = [
	"- Sends a message to another agent: more work, a correction, a question. A subagent that went idle, was stopped, or was cut off mid-work picks it up with its context intact and resumes where it left off — this is how an old one is woken; a busy one reads it at its next step, inside the run it is in",
	"- This is a message, not a call: it does not wait for anything",
	"- Your own subagent reports to you automatically when its run ends. To hear from it before that, ask it in the message to send one",
	"- Your parent, your siblings and anyone else do not reply automatically. If you need an answer, ask for it in the message; it arrives, if at all, as a message they send",
	"- What comes back means the message was accepted for delivery — not that it was processed, and not that an answer is coming",
	"- Reaches your parent, children and siblings by name or session_id, and any agent at all by session_id",
	"- The recipient acts under its own permissions: this is not a way to have work done that you are not allowed to do yourself",
	"- Your identity is attached automatically and cannot be set from here",
].join("\n");

const STOP_DESCRIPTION = [
	"- Stops the current run of an agent you launched, and the runs of everything it launched in turn",
	"- Only your own direct children can be named as the target; the cascade to their descendants follows automatically",
	"- Nothing is deleted. The session and its history survive, so a stopped agent can be picked up again with agent_send",
	"- The result says which agents a stop was performed on. That is not a claim that each was busy — stopping an idle one is harmless, reported the same way, and repeating the call is safe",
].join("\n");

export interface HcAgentToolsOptions {
	readonly services: HcAgentRuntimeServices;
	readonly depth: number;
	readonly permitted: readonly string[] | undefined;
	readonly callerVariant: () => string;
}

function toolResult(output: HcToolOutput) {
	return {
		content: [{ type: "text" as const, text: output.output }],
		details: { title: output.title, metadata: output.metadata },
	};
}

/** HC domain failures are normal results with metadata={} and the error text, never isError. */
async function executeHcTool(title: string, run: () => Promise<HcToolOutput>) {
	try {
		return toolResult(await run());
	} catch (error) {
		if (error instanceof HcAgentDomainError) {
			return toolResult({ title, metadata: {}, output: error.message });
		}
		throw error;
	}
}

function callerModel(ctx: ExtensionToolContext): HcAgentModel {
	const model = ctx.model;
	if (!model) throw new Error("agent must be called from an assistant message");
	return { providerID: model.provider, modelID: model.id };
}

function callerId(ctx: ExtensionToolContext, services: HcAgentRuntimeServices): string {
	const hostId = ctx.sessionManager.getSessionId();
	if (hostId === services.root.sessionId) return services.root.rootSessionId;
	return services.directory.protocolIdOf(hostId) ?? hostId;
}

/** The four HC model tools with their native schemas, descriptions, receipts, and domain errors. */
export function registerHcAgentTools(pi: ExtensionAPI, options: HcAgentToolsOptions): () => void {
	const services = options.services;
	let live = true;
	const guard = () => {
		if (!live) throw new Error("hc agent tools closed");
	};
	const active = new Set<HcAgentToolName>(availableAgentTools(options.depth, services.subagentDepth));
	const availableLines = hcAgentDescriptionLines(services.catalog, options.permitted);
	const agentToolDescription = `${AGENT_DESCRIPTION}\nAvailable agent types and the tools they have access to:\n${availableLines.join("\n")}`;
	if (active.has("agent")) {
		pi.registerTool({
			name: "agent",
			label: "agent",
			description: agentToolDescription,
			parameters: Type.Object({
				description: Type.String({ description: "A short (3-5 word) description of the task" }),
				prompt: Type.String({ description: "The task for the agent to perform" }),
				subagent_type: Type.String({ description: "The type of specialized agent to use for this task" }),
				name: Type.Optional(Type.String({ description: "Optional short name for this Agent, used to address it later with agent_send or agent_stop. Must not start with 'ses'. Names are a convenience: they are not guaranteed unique, and an ambiguous name is refused rather than guessed." })),
				cwd: Type.Optional(Type.String({ description: "Working directory for this Agent. To have it continue work in an existing directory or worktree, pass that path here. When omitted a NEW working directory is created and the Agent is told to use it -- so a directory named only in the prompt will be contradicted by that instruction." })),
			}),
			async execute(_id, input, signal, _update, ctx) {
				guard();
				signal?.throwIfAborted();
				return executeHcTool(input.description, async () => {
					const started = await createHcAgent(services, {
						caller: callerId(ctx, services),
						description: input.description,
						prompt: input.prompt,
						subagent_type: input.subagent_type,
						name: input.name || undefined,
						cwd: input.cwd || undefined,
						callerModel: callerModel(ctx),
						callerVariant: options.callerVariant(),
					});
					return formatAgentStarted(started);
				});
			},
		});
	}
	if (active.has("agent_list")) {
		pi.registerTool({
			name: "agent_list",
			label: "agent_list",
			description: LIST_DESCRIPTION,
			parameters: Type.Object({}),
			async execute(_id, _input, _signal, _update, ctx) {
				guard();
				return executeHcTool("agents", async () => {
					const caller = callerId(ctx, services);
					const members = agentNeighborhood(caller, services.directory.toAgentSessions())
						.map((member) => member.relation === "self" ? { ...member, status: "running" as const } : member);
					return formatAgentList(members);
				});
			},
		});
	}
	if (active.has("agent_send")) {
		pi.registerTool({
			name: "agent_send",
			label: "agent_send",
			description: SEND_DESCRIPTION,
			parameters: Type.Object({
				target: Type.String({ description: "The session_id of the Agent to message, or the name of one of your neighbours" }),
				message: Type.String({ description: "The message to deliver" }),
			}),
			async execute(_id, input, signal, _update, ctx) {
				guard();
				signal?.throwIfAborted();
				return executeHcTool(input.target, async () => {
					const accepted = await sendHcAgent(services, { caller: callerId(ctx, services), target: input.target, message: input.message }).catch((error) => {
					if (process.env.FSM_DUAL_DEBUG) console.error("[hc-send-failed]", input.target, error instanceof Error ? error.stack : error);
					throw error;
				});
					return formatAgentAccepted(input.target, accepted.resolved);
				});
			},
		});
	}
	if (active.has("agent_stop")) {
		pi.registerTool({
			name: "agent_stop",
			label: "agent_stop",
			description: STOP_DESCRIPTION,
			parameters: Type.Object({
				target: Type.String({ description: "The session_id of the Agent to stop, or the name of one of your direct children" }),
			}),
			async execute(_id, input, signal, _update, ctx) {
				guard();
				signal?.throwIfAborted();
				return executeHcTool(input.target, async () => {
					const outcome = await stopHcAgent(services, { caller: callerId(ctx, services), target: input.target });
					return formatAgentStopped(input.target, outcome);
				});
			},
		});
	}
	return () => {
		live = false;
	};
}
