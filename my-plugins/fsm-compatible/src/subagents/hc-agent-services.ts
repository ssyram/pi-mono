import type { RootBinding } from "../binding/actor-binding.ts";
import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import type { HcSessionDirectory } from "./hc-session-directory.ts";
import type { HcNicoSessionHost, HcNicoLaunchPlan } from "./hc-nico-host.ts";
import type { HcAgentDefinition } from "./hc-agent-definitions.ts";
import type { HcAgentMessage } from "./hc-agent-types.ts";
import type { HcSessionRecord, HcSessionSnapshot } from "./hc-session-record.ts";
import type { CrossTreeRegistry } from "./hc-session-registry.ts";
import type { ChildSessionEvent } from "./hc-nico-factory.ts";

/** Services shared by the facade, lifecycle flows, reports, and every child hook. */
export interface HcAgentRuntimeServices {
	readonly root: RootBinding;
	readonly policy: AdmissionPolicy;
	readonly directory: HcSessionDirectory;
	readonly host: HcNicoSessionHost;
	readonly catalog: readonly HcAgentDefinition[];
	readonly instanceDirectory: string;
	readonly stateDirectory: string;
	/** HC subagent_depth (default 3), not the FSM admission maxDepth. */
	readonly subagentDepth: number;
	readonly persist: (snapshot: HcSessionSnapshot) => void;
	/** Registers the created actor before the child's first FSM call. */
	acquireActor(agentId: string): Promise<void>;
	/** Delivers a rendered HC inbox message to a session of this tree. */
	deliverMessage(message: HcAgentMessage): Promise<void>;
	/** Delivers already-rendered inbox text; false when this tree has no such session. */
	deliverRendered(target: string, text: string): Promise<boolean>;
	/** Shared sid->owner registry enabling agent_send beyond this tree. */
	readonly crossTree?: CrossTreeRegistry;
	/** Synthetic agent_notification to the root conversation (metadata preserved, not inbox-wrapped). */
	deliverNotification(parentId: string, text: string, meta: { kind: string; summary: string }): Promise<void>;
	/** Delegation started/settled facts for the HTTP surface and store. */
	publishDelegation(record: HcSessionRecord, status: "started" | "settled"): Promise<void>;
	/** Child session events from the owning host. */
	observe(record: HcSessionRecord, event: ChildSessionEvent): void;
	/** Builds the launch plan for a record (definition + model + depth wiring). */
	launchPlan(record: HcSessionRecord): HcNicoLaunchPlan;
	/** FSM stop-gate dependency: any live run below this session. */
	hasBusyDescendant(sessionId: string): boolean;
}
