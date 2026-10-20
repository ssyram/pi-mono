import { RuntimeError } from "./runtime-error.ts";

export type ResourceDisposer = (deadline: number) => void | Promise<void>;

export class RuntimeResources {
	private readonly disposers: ResourceDisposer[] = [];
	private closing: Promise<void> | undefined;
	private active = true;
	readonly signal: AbortSignal;
	private readonly controller = new AbortController();

	constructor() { this.signal = this.controller.signal; }

	own(disposer: ResourceDisposer): void {
		if (!this.active) throw new RuntimeError("owner-unavailable");
		this.disposers.push(disposer);
	}

	get open(): boolean { return this.active; }

	close(deadline: number): Promise<void> {
		if (this.closing) return this.closing;
		// Step P4: revoke admission before closing resources in reverse acquisition order.
		this.active = false;
		this.controller.abort();
		const disposers = this.disposers.splice(0).reverse();
		this.closing = (async () => {
			const failures: unknown[] = [];
			for (const dispose of disposers) {
				try { await dispose(deadline); } catch (error) { failures.push(error); }
			}
			if (failures.length) throw new AggregateError(failures, "FSM resource shutdown failed");
		})();
		return this.closing;
	}
}
