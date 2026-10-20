import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PersistedBinding } from "../binding/actor-binding.ts";
import { bindNewChild } from "../binding/bind-new-child.ts";
import { readPersistedBinding } from "../binding/read-persisted-binding.ts";
import { restoreActorBinding } from "../binding/restore-actor-binding.ts";
import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import type { BindingRecords, PendingLaunch } from "../binding/actor-binding.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { RootLaunches, type BootstrapPayload } from "./root-launches.ts";

export type ChildGateBinding = { readonly sessionId: string; readonly agentId: string };

/**
 * Child-side session bootstrap: strips the model-invisible bootstrap prefix from
 * the first input, then restores or binds the child identity before any task.
 */
export class ChildSideBootstrap {
	private consumed = false;
	private bootstrapRef: string | null = null;
	private payload: BootstrapPayload | null = null;
	binding: PersistedBinding | null = null;
	private readonly scope: string;

	constructor(scope: string) { this.scope = scope; }

	inputTransformer(text: string): { action: "transform"; text: string } | undefined {
		if (this.consumed) return undefined;
		const split = RootLaunches.splitBootstrapTask(text);
		if (!split) return undefined;
		this.consumed = true;
		this.bootstrapRef = split.bootstrapRef;
		return { action: "transform", text: split.task };
	}

	async loadPayload(): Promise<BootstrapPayload> {
		if (!this.bootstrapRef) throw new RuntimeError("not-ready");
		if (!this.payload) this.payload = await RootLaunches.readBootstrap(this.scope, this.bootstrapRef);
		return this.payload;
	}

	async initialize(actualSessionId: string, entries: readonly SessionEntry[], records: BindingRecords,
		policy: AdmissionPolicy, pending: PendingLaunch): Promise<PersistedBinding> {
		const saved = readPersistedBinding(entries, actualSessionId);
		if (saved.ok && saved.value) {
			if (saved.value.kind === "execution-root") throw new RuntimeError("not-ready");
			const restored = restoreActorBinding(policy, saved.value, actualSessionId, saved.value.rootSessionId, records);
			if (!restored.ok) throw new RuntimeError("not-ready");
			this.binding = restored.value;
			return restored.value;
		}
		if (!saved.ok) throw new RuntimeError("not-ready");
		const bound = bindNewChild(policy, pending, actualSessionId, entries, records);
		if (!bound.ok) throw new RuntimeError("not-ready");
		this.binding = bound.value;
		return bound.value;
	}

	gateBinding(): ChildGateBinding | undefined {
		if (!this.binding) return undefined;
		return { sessionId: this.binding.sessionId, agentId: this.binding.agentId };
	}
}

export function installChildInputGate(pi: ExtensionAPI, bootstrap: ChildSideBootstrap): () => void {
	return pi.on("input", (event: { text: string }) => bootstrap.inputTransformer(event.text));
}
