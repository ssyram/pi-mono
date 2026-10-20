import { RuntimeError } from "./runtime-error.ts";

export interface ManagedFactoryIdentity {
	readonly id: string;
	readonly canonicalPath: string;
}
export interface StartupEpoch {
	readonly number: number;
	readonly sessionId: string;
}
interface EpochState {
	readonly epoch: StartupEpoch;
	readonly expected: ReadonlySet<string>;
	readonly completed: Set<string>;
	failed: boolean;
	prepared: boolean;
	committed: boolean;
}

export class RootHealth {
	private readonly factories: ReadonlyMap<string, ManagedFactoryIdentity>;
	private readonly initialized = new Map<string, boolean>();
	private readonly active = new Map<string, string>();
	private nextToken = 0;
	private nextEpoch = 0;
	private current: EpochState | undefined;
	private closed = false;

	constructor(factories: readonly ManagedFactoryIdentity[]) {
		if (!factories.length || new Set(factories.map((item) => item.id)).size !== factories.length) throw new RuntimeError("protocol-invalid");
		this.factories = new Map(factories.map((item) => [item.id, Object.freeze({ ...item })]));
	}

	markInitialized(id: string, success: boolean): void {
		this.assertFactory(id);
		if (this.initialized.get(id) === false) return;
		this.initialized.set(id, success);
		if (!success && this.current) this.current.failed = true;
	}

	registerStartup(id: string): { readonly token: string; readonly deactivate: () => void } {
		this.assertFactory(id);
		const token = `${id}:${++this.nextToken}`;
		this.active.set(token, id);
		return Object.freeze({ token, deactivate: () => { this.active.delete(token); } });
	}

	begin(sessionId: string): StartupEpoch {
		if (this.closed || !sessionId) throw new RuntimeError("not-ready");
		// Step P1: freeze this event's obligations; subsequent on/off changes only the future set.
		const epoch = Object.freeze({ number: ++this.nextEpoch, sessionId });
		this.current = { epoch, expected: new Set(this.active.keys()), completed: new Set(), failed: false, prepared: false, committed: false };
		return epoch;
	}

	observe(epoch: StartupEpoch, sessionId: string, token: string, success: boolean): void {
		const state = this.match(epoch, sessionId);
		if (!state || !state.expected.has(token)) return;
		if (!success) state.failed = true;
		else state.completed.add(token);
	}

	markPrepared(epoch: StartupEpoch, sessionId: string): void {
		const state = this.match(epoch, sessionId);
		if (state) state.prepared = true;
	}

	commit(epoch: StartupEpoch): boolean {
		const state = this.match(epoch, epoch.sessionId);
		if (!state || state.committed || !state.prepared || state.failed) return false;
		if ([...this.factories.keys()].some((id) => this.initialized.get(id) !== true)) return false;
		if ([...state.expected].some((token) => !state.completed.has(token))) return false;
		state.committed = true;
		return true;
	}

	get ready(): boolean { return !this.closed && this.current?.committed === true && !this.current.failed; }
	get epoch(): StartupEpoch | undefined { return this.current?.epoch; }

	close(): void {
		this.closed = true;
		if (this.current) this.current.failed = true;
		this.active.clear();
	}

	private assertFactory(id: string): void {
		if (this.closed || !this.factories.has(id)) throw new RuntimeError("not-ready");
	}

	private match(epoch: StartupEpoch, sessionId: string): EpochState | undefined {
		const state = this.current;
		return !this.closed && state?.epoch === epoch && epoch.sessionId === sessionId ? state : undefined;
	}
}
