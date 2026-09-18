import type { LoopV2Core } from "./loop-core.js";
import type { DeliverTask } from "./registration-executor.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const FAILURE_RETRY_MS = 60_000;

export type TimerHandle = {
	unref?(): void;
	ref?(): void;
};

export type DuePollerTimers = {
	set(handler: () => void, timeoutMs: number): TimerHandle;
	clear(handle: TimerHandle): void;
};

export type DuePollerOptions = {
	core: LoopV2Core;
	deliver: DeliverTask;
	/** Keep the timer referenced (PI_SCHEDULED_WAKEUP_RUNNER mode keeps `pi -p` alive). */
	keepAlive?: boolean;
	now?: () => number;
	timers?: DuePollerTimers;
};

const defaultTimers: DuePollerTimers = {
	set: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Adaptive scheduler: arms one timer at the nearest active nextRunAt, runs
 * due work, then re-arms. Oversized waits chunk through MAX_TIMEOUT_MS refires.
 */
export class DuePoller {
	private readonly core: LoopV2Core;
	private readonly deliver: DeliverTask;
	private readonly keepAlive: boolean;
	private readonly now: () => number;
	private readonly timers: DuePollerTimers;
	private handle: TimerHandle | undefined;
	private running = false;
	private disposed = false;
	private backoff = false;

	constructor(options: DuePollerOptions) {
		this.core = options.core;
		this.deliver = options.deliver;
		this.keepAlive = options.keepAlive ?? false;
		this.now = options.now ?? Date.now;
		this.timers = options.timers ?? defaultTimers;
	}

	get isRunning(): boolean {
		return this.running;
	}

	get hasTimer(): boolean {
		return this.handle !== undefined;
	}

	start(): void {
		if (this.disposed || this.running) return;
		this.running = true;
		this.armNext();
	}

	stop(): void {
		this.clearHandle();
		this.running = false;
	}

	dispose(): void {
		this.stop();
		this.disposed = true;
	}

	/** Re-arm after any state mutation. No-op while stopped. */
	reschedule(): void {
		if (this.disposed || !this.running) return;
		this.clearHandle();
		this.armNext();
	}

	private clearHandle(): void {
		const handle = this.handle;
		if (handle === undefined) return;
		this.timers.clear(handle);
		this.handle = undefined;
	}

	private armNext(): void {
		const now = this.now();
		let nextRunAt: number | undefined;
		for (const active of this.core.listActive()) {
			const progress = active.kind === "session" ? active.task.progress : active.registration.progress;
			if (progress.status !== "active") continue;
			if (nextRunAt === undefined || progress.nextRunAt < nextRunAt) nextRunAt = progress.nextRunAt;
		}
		if (nextRunAt === undefined) return;
		let delay = Math.max(0, nextRunAt - now);
		if (delay === 0 && this.backoff) delay = FAILURE_RETRY_MS;
		delay = Math.min(delay, MAX_TIMEOUT_MS);
		const handle = this.timers.set(() => this.fire(), delay);
		if (!this.keepAlive) handle.unref?.();
		this.handle = handle;
	}

	private fire(): void {
		this.handle = undefined;
		let backoff = true;
		try {
			const results = this.core.runDue(this.deliver);
			backoff = results.some((result) => result.kind !== "executed");
		} catch {
			backoff = true;
		}
		this.backoff = backoff;
		if (this.running) this.armNext();
	}
}
