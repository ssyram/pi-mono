import type { PersistedBinding } from "../binding/actor-binding.ts";
import { acquireCanonicalLease, coordinationScope } from "../coordination/canonical-lease.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import type { HostIdentity } from "../runtime/host-identity.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { requestMutation, requireDaemonOk, type DaemonRequester } from "./daemon-request.ts";
import type { FsmTool } from "./fsm-catalog.ts";
import type { McpTransport, RpcOptions } from "./mcp-transport.ts";
import { registerAndConfirmSource, type SourceOwner } from "./register-source.ts";

export interface FsmBrokerOptions {
	readonly host: HostIdentity;
	readonly source: SourceOwner;
	readonly request: DaemonRequester;
	readonly transport: McpTransport;
	readonly catalog: ReadonlyMap<string, FsmTool>;
	readonly scope?: string;
	readonly capacity?: number;
}

export class FsmBroker {
	private readonly options: FsmBrokerOptions;
	private usable = true;
	private failureReason = "closed";
	private pending = 0;
	private readonly controller = new AbortController();
	private readonly capacity: number;

	constructor(options: FsmBrokerOptions) {
		this.capacity = options.capacity ?? 64;
		if (options.source.pid !== options.host.pid || !Number.isInteger(this.capacity) || this.capacity < 1) {
			throw new RuntimeError("protocol-invalid");
		}
		this.options = options;
	}

	async invoke(binding: PersistedBinding, name: string, input: unknown, call: RpcOptions): Promise<Record<string, unknown>> {
		if (!this.usable) throw new RuntimeError("not-ready", `FSM broker not ready: ${this.failureReason}`);
		if (this.pending >= this.capacity) throw new RuntimeError("queue-full");
		this.pending++;
		const signal = call.signal ? AbortSignal.any([call.signal, this.controller.signal]) : this.controller.signal;
		try { return await this.invokeAdmitted(binding, name, input, { ...call, signal }); } finally { this.pending--; }
	}

	private async invokeAdmitted(binding: PersistedBinding, name: string, input: unknown, call: RpcOptions): Promise<Record<string, unknown>> {
		// Step P3: acquire and invocation share one physical-host/canonical lease.
		if (!this.usable || binding.rootSessionId !== this.options.source.rootSessionId) throw new RuntimeError("not-ready");
		if ((binding.kind === "execution-root" && binding.agentId !== "main")
			|| (binding.kind === "execution-child" && (binding.agentId !== binding.sessionId || binding.agentId === "main"))) {
			throw new RuntimeError("protocol-invalid");
		}
		const tool = this.options.catalog.get(name);
		if (!tool || !isAdmissionObject(input) || !tool.validate(input)) throw new RuntimeError("protocol-invalid");
		const lease = await acquireCanonicalLease(this.options.scope ?? coordinationScope(), this.options.host, name,
			binding.rootSessionId, call.deadline, call.signal);
		let sent = false;
		let safeToRelease = true;
		try {
			if (!this.usable) throw new RuntimeError("not-ready");
			await registerAndConfirmSource(this.options.request, this.options.source, call.deadline, call.signal);
			const identity = await requestMutation(this.options.request, {
				method: "POST", path: "/identity/acquire", deadline: call.deadline, ...(call.signal ? { signal: call.signal } : {}),
				body: { session_id: binding.rootSessionId, agent_id: binding.agentId, tool_name: name,
					agent_cli: "opencode", opencode_server_url: this.options.source.serverUrl },
			});
			requireDaemonOk(identity);
			sent = true;
			const result = await this.options.transport.call("tools/call", { name, arguments: input }, call);
			if (!isAdmissionObject(result) || !Array.isArray(result.content)) throw new RuntimeError("protocol-invalid");
			return result;
		} catch (error) {
			if (error instanceof RuntimeError) this.failureReason = error.message;
			if (!sent && error instanceof RuntimeError && error.code === "delivery-unknown") {
				this.usable = false;
				safeToRelease = false;
				await this.options.transport.close(Date.now() + 10000);
			}
			if (sent) {
				this.usable = false;
				safeToRelease = await this.options.transport.close(Date.now() + 10000);
				if (!safeToRelease) throw new RuntimeError("delivery-unknown");
			}
			throw error;
		} finally {
			if (safeToRelease) await lease.release();
		}
	}

	async acquireActor(binding: PersistedBinding, call: RpcOptions): Promise<void> {
		if (!this.usable || binding.rootSessionId !== this.options.source.rootSessionId) throw new RuntimeError("not-ready");
		await registerAndConfirmSource(this.options.request, this.options.source, call.deadline, call.signal);
		requireDaemonOk(await requestMutation(this.options.request, { method: "POST", path: "/actor/acquire", deadline: call.deadline,
			...(call.signal ? { signal: call.signal } : {}), body: { session_id: binding.rootSessionId, agent_id: binding.agentId } }));
	}

	async close(deadline: number): Promise<boolean> {
		this.usable = false;
		this.controller.abort();
		return this.options.transport.close(deadline);
	}
}
