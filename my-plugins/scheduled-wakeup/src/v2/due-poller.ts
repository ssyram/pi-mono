import type { LoopV2Core } from "./loop-core.js";
import type { DeliverTask } from "./registration-executor.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const FAILURE_RETRY_MS = 60_000;

export type DuePollerRefreshResult =
	| { ok: true }
	| { ok: false; message: string; cause?: unknown };

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
	/** Invoked after each due-run completes (progress may have advanced to completed/expired). */
	afterRun?: () => void;
	onError?: (error: unknown) => void;
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
	private readonly afterRun: (() => void) | undefined;
	private readonly onError: ((error: unknown) => void) | undefined;
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
		this.afterRun = options.afterRun;
		this.onError = options.onError;
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
		try {
			this.armNext();
		} catch (error) {
			this.stop();
			throw error;
		}
	}

	stop(): void {
		this.running = false;
		this.clearHandle();
	}

	dispose(): void {
		this.stop();
		this.disposed = true;
	}

	/** Re-arm after mutations; a stopped poller remains stopped and reports failure. */
	reschedule(): DuePollerRefreshResult {
		if (this.disposed || !this.running)
			return { ok: false, message: "Loop due polling is stopped" };
		try {
			this.clearHandle();
			this.armNext();
			return { ok: true };
		} catch (cause) {
			let message = "Loop due polling stopped after reschedule failure";
			try {
				this.stop();
			} catch {
				message += "; timer cleanup also failed";
			}
			return { ok: false, message, cause };
		}
	}

	private clearHandle(): void {
		const handle = this.handle;
		if (handle === undefined) return;
		this.handle = undefined;
		this.timers.clear(handle);
	}

	private armNext(): void {
		const now = this.now();
		let nextRunAt: number | undefined;
		for (const active of this.core.listActive()) {
			const progress =
				active.kind === "session"
					? active.task.progress
					: active.registration.progress;
			if (progress.status !== "active") continue;
			if (nextRunAt === undefined || progress.nextRunAt < nextRunAt)
				nextRunAt = progress.nextRunAt;
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
		if (!this.running || this.disposed) return;
		let backoff = true;
		try {
			const results = this.core.runDue(this.deliver);
			backoff = results.some((result) => result.kind !== "executed");
		} catch {
			backoff = true;
		}
		this.backoff = backoff;
		try {
			this.afterRun?.();
		} catch {
			/* afterRun is a diagnostics hook; never break scheduling on it */
		}
		try {
			if (this.running) this.armNext();
		} catch (error) {
			try {
				this.stop();
			} catch {
				/* The callback must not escape during cleanup. */
			}
			try {
				this.onError?.(error);
			} catch {
				/* Diagnostics must not escape either. */
			}
		}
	}
}
