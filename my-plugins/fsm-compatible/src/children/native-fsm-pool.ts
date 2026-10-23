import type { PersistedBinding } from "../binding/actor-binding.ts";
import { prepareBrokerChannel, type BrokerChannel, type BrokerChannelConfig } from "../broker/broker-channel.ts";
import type { FsmInvoker } from "../broker/fsm-tools.ts";
import type { RpcOptions } from "../broker/mcp-transport.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { DaemonRequester } from "../broker/daemon-request.ts";

function isChannelUnusable(error: unknown): boolean {
	return error instanceof RuntimeError && error.code === "transport-failed";
}

export class NativeFsmPool implements FsmInvoker {
	private readonly channels = new Map<string, Promise<BrokerChannel>>();
	private readonly config: BrokerChannelConfig;
	private primary: BrokerChannel;
	private readonly signal: AbortSignal;
	private readonly controller = new AbortController();
	private readonly request: DaemonRequester;
	private readonly startupTimeoutMs: number;
	private ownedPrimary: Promise<BrokerChannel> | undefined;

	private readonly cwdFor: (agentId: string) => string;

	constructor(primary: BrokerChannel, config: BrokerChannelConfig, signal: AbortSignal,
		request: DaemonRequester, startupTimeoutMs: number, cwdFor?: (agentId: string) => string) {
		this.primary = primary; this.config = config; this.signal = AbortSignal.any([signal, this.controller.signal]);
		this.request = request; this.startupTimeoutMs = startupTimeoutMs;
		this.cwdFor = cwdFor ?? (() => config.cwd);
		this.ownedPrimary = undefined;
	}

	get catalog() { return this.primary.catalog; }

	private async freshPrimary(): Promise<BrokerChannel> {
		const pending = prepareBrokerChannel(this.config, Date.now() + this.startupTimeoutMs, this.signal, this.request);
		this.ownedPrimary = pending;
		const channel = await pending;
		if (this.primary !== channel) {
			const replaced = this.primary;
			this.primary = channel;
			void replaced.close(Date.now() + this.startupTimeoutMs).catch(() => undefined);
		}
		return channel;
	}

	async invoke(binding: PersistedBinding, name: string, input: unknown, options: RpcOptions): Promise<Record<string, unknown>> {
		if (binding.kind === "execution-child") {
			const agentId = binding.agentId;
			let pending = this.channels.get(agentId);
			if (!pending) {
				const childConfig = { ...this.config, cwd: this.cwdFor(agentId) };
				pending = prepareBrokerChannel(childConfig, Math.min(options.deadline, Date.now() + this.startupTimeoutMs), this.signal, this.request);
				this.channels.set(agentId, pending);
			}
			const waited = pending;
			let channel: BrokerChannel;
			try { channel = await waited; }
			catch (error) {
				// Initialization rejection: evict only if nobody replaced the entry meanwhile.
				if (this.channels.get(agentId) === waited) this.channels.delete(agentId);
				throw error;
			}
			try {
				options.signal?.throwIfAborted();
				return await channel.broker.invoke(binding, name, input, options);
			} catch (error) {
				// An established broker that failed at the transport level is unusable;
				// drop it so the next explicit call prepares a fresh channel.
				if (isChannelUnusable(error) && this.channels.get(agentId) === waited) this.channels.delete(agentId);
				throw error;
			}
		}
		try {
			options.signal?.throwIfAborted();
			return await this.primary.broker.invoke(binding, name, input, options);
		} catch (error) {
			if (isChannelUnusable(error)) {
				try { await this.freshPrimary(); }
				catch { /* the original failure propagates; the next call retries the connection */ }
			}
			throw error;
		}
	}

	async close(deadline: number): Promise<void> {
		this.controller.abort();
		const closing = [...this.channels.values()];
		const owned = this.ownedPrimary ? [this.ownedPrimary] : [];
		const results = await Promise.allSettled([...closing, ...owned].map(async (pending: Promise<BrokerChannel>) => {
			let channel: BrokerChannel;
			try { channel = await pending; } catch (error) { if (error instanceof AggregateError) throw error; return; }
			await channel.close(deadline);
		}));
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "native FSM channels could not close");
	}
}
