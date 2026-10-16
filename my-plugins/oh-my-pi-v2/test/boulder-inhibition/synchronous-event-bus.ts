import type { BoulderInhibitionEventBus } from "../../boulder-inhibition/service-protocol.ts";

type Handler = (data: unknown) => void;

export class SynchronousEventBus implements BoulderInhibitionEventBus {
	readonly emissions: { channel: string; data: unknown }[] = [];
	readonly subscriptions: { channel: string; handler: Handler; dispose: () => void }[] = [];
	readonly handlerErrors: unknown[] = [];
	readonly events: string[] = [];
	private readonly handlers = new Map<string, Set<Handler>>();

	on(channel: string, handler: Handler): () => void {
		this.events.push(`on:${channel}`);
		const handlers = this.handlers.get(channel) ?? new Set<Handler>();
		this.handlers.set(channel, handlers);
		handlers.add(handler);
		const dispose = (): void => {
			this.events.push(`dispose:${channel}`);
			handlers.delete(handler);
		};
		this.subscriptions.push({ channel, handler, dispose });
		return dispose;
	}

	emit(channel: string, data: unknown): void {
		this.emissions.push({ channel, data });
		this.events.push(`emit:${channel}`);
		for (const handler of [...(this.handlers.get(channel) ?? [])]) {
			try {
				handler(data);
			} catch (error) {
				this.handlerErrors.push(error);
			}
		}
		this.events.push(`returned:${channel}`);
	}
}
