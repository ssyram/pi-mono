/**
 * FIFO concurrency manager for parallel agent task execution.
 *
 * Supports per-model/provider concurrency limits, real abort via AbortController,
 * stale timeout auto-cancellation, and parent-child job tracking.
 */

import { randomUUID } from "node:crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ConcurrencyConfig {
	/** Default per-key concurrency limit. @default 5 */
	defaultConcurrency: number;
	/** Override concurrency limit per model id (e.g. "claude-sonnet-4-20250514" → 3). */
	modelConcurrency?: Record<string, number>;
	/** Override concurrency limit per provider (e.g. "anthropic" → 8). */
	providerConcurrency?: Record<string, number>;
	/** Hard upper bound on total active tasks (queued + running). @default 20 */
	maxTotal: number;
	/** Timeout (ms) after which a running job is aborted as stale. @default 180000 */
	staleTimeoutMs: number;
	/** Maximum number of completed jobs to retain. @default 100 */
	maxCompleted: number;
}

const DEFAULT_CONFIG: ConcurrencyConfig = {
	defaultConcurrency: 5,
	maxTotal: 20,
	staleTimeoutMs: 180_000,
	maxCompleted: 100,
};

// ─── Job ─────────────────────────────────────────────────────────────────────

export interface Job {
	id: string;
	task: string;
	agent: string;
	model: string;
	status: "queued" | "running" | "completed" | "error" | "cancelled";
	result?: string;
	error?: string;
	startedAt?: number;
	createdAt: number;
	/** Key used for per-model/provider concurrency bucketing. */
	concurrencyKey: string;
	/** Parent job ID for hierarchical task tracking. */
	parentJobId?: string;
	/** @internal Not included in sanitized output. */
	runner?: (signal: AbortSignal) => Promise<string>;
	/** @internal Not included in sanitized output. */
	abortController?: AbortController;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class ConcurrencyManager {
	private config: ConcurrencyConfig;
	private queue: Job[] = [];
	private running: Map<string, Job> = new Map();
	private completed: Map<string, Job> = new Map();
	private staleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private onJobDone?: (job: Job) => void;
	private onStatusChange?: (counts: { running: number; queued: number }) => void;
	private viewedJobs = new Set<string>();

	constructor(config?: Partial<ConcurrencyConfig>, onJobDone?: (job: Job) => void) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.onJobDone = onJobDone;
	}

	/**
	 * Register a callback that fires whenever the active job counts change.
	 * Receives { running, queued } counts.
	 */
	setOnStatusChange(handler: (counts: { running: number; queued: number }) => void): void {
		this.onStatusChange = handler;
	}

	/** Mark a job as viewed (its output was read by the agent). */
	markViewed(jobId: string): void {
		this.viewedJobs.add(jobId);
	}

	/** Check whether a job's output has been viewed by the agent. */
	isViewed(jobId: string): boolean {
		return this.viewedJobs.has(jobId);
	}

	/**
	 * Get the current number of running and queued jobs.
	 */
	getActiveCounts(): { running: number; queued: number } {
		return { running: this.running.size, queued: this.queue.length };
	}

	// ─── Public API ────────────────────────────────────────────────────────

	/**
	 * Submit a new job. Returns the job ID immediately.
	 * The job is queued and will start when a slot is available.
	 */
	submit(
		task: string,
		agent: string,
		model: string,
		runner: (signal: AbortSignal) => Promise<string>,
		options?: { parentId?: string; concurrencyKey?: string },
	): string {
		// Guard: prevent unbounded sub-agent spawning
		const activeCount = this.running.size + this.queue.length;
		if (activeCount >= this.config.maxTotal) {
			throw new Error(
				`Maximum total tasks (${this.config.maxTotal}) reached (${this.running.size} running, ${this.queue.length} queued). ` +
				`Wait for existing tasks to complete or cancel some before submitting new ones.`,
			);
		}

		const id = randomUUID();
		const concurrencyKey = options?.concurrencyKey ?? this.deriveConcurrencyKey(model);
		const controller = new AbortController();
		const job: Job = {
			id,
			task,
			agent,
			model,
			status: "queued",
			createdAt: Date.now(),
			concurrencyKey,
			parentJobId: options?.parentId,
			runner,
			abortController: controller,
		};
		this.queue.push(job);
		this.drain();
		this.notifyStatusChange();
		return id;
	}

	/**
	 * Cancel a queued or running job. Returns true if the job was found and cancelled.
	 * Running jobs are aborted via their AbortController.
	 */
	cancel(jobId: string): boolean {
		// Check queue first
		const queueIdx = this.queue.findIndex((j) => j.id === jobId);
		if (queueIdx !== -1) {
			const job = this.queue.splice(queueIdx, 1)[0];
			job.status = "cancelled";
			job.abortController?.abort();
			delete job.runner;
			delete job.abortController;
			this.completed.set(job.id, job);
			this.evictOldest();
			try { this.onJobDone?.(this.sanitizeJob(job)); } catch { /* must not break */ }
			this.notifyStatusChange();
			return true;
		}

		// Check running
		const runningJob = this.running.get(jobId);
		if (runningJob) {
			runningJob.status = "cancelled";
			runningJob.abortController?.abort();
			delete runningJob.runner;
			delete runningJob.abortController;
			this.running.delete(jobId);
			this.clearStaleTimer(jobId);
			this.completed.set(jobId, runningJob);
			this.evictOldest();
			try { this.onJobDone?.(this.sanitizeJob(runningJob)); } catch { /* must not break */ }
			this.drain();
			this.notifyStatusChange();
			return true;
		}

		return false;
	}

	/**
	 * Get the current status of a job by ID.
	 */
	getStatus(jobId: string): Job | undefined {
		// Search queue
		const queued = this.queue.find((j) => j.id === jobId);
		if (queued) {
			return this.sanitizeJob(queued);
		}

		// Search running
		const running = this.running.get(jobId);
		if (running) {
			return this.sanitizeJob(running);
		}

		// Search completed
		const done = this.completed.get(jobId);
		if (done) {
			return done; // already sanitized on completion
		}

		return undefined;
	}

	/**
	 * List all jobs (queued, running, completed) ordered by creation time.
	 */
	list(): Job[] {
		const all: Job[] = [
			...this.queue.map((j) => this.sanitizeJob(j)),
			...[...this.running.values()].map((j) => this.sanitizeJob(j)),
			...[...this.completed.values()],
		];
		return all.sort((a, b) => a.createdAt - b.createdAt);
	}

	// ─── Parent-child tracking ─────────────────────────────────────────────

	/**
	 * Get direct children of a job.
	 */
	getChildren(jobId: string): Job[] {
		return [...this.running.values(), ...this.queue, ...this.completed.values()]
			.filter((j) => j.parentJobId === jobId)
			.map((j) => this.sanitizeJob(j));
	}

	/**
	 * Get all descendants (children, grandchildren, ...) of a job.
	 */
	getAllDescendants(jobId: string): Job[] {
		const result: Job[] = [];
		const visited = new Set<string>();
		const stack = [jobId];
		visited.add(jobId);
		while (stack.length > 0) {
			const id = stack.pop()!;
			const children = this.getChildrenRaw(id);
			for (const child of children) {
				if (visited.has(child.id)) continue;
				visited.add(child.id);
				result.push(this.sanitizeJob(child));
				stack.push(child.id);
			}
		}
		return result;
	}

	/**
	 * Cancel a job and all its descendants. Returns the number of jobs cancelled.
	 */
	cancelAll(jobId: string): number {
		const descendants = this.getAllDescendantsRaw(jobId);
		let count = 0;
		for (const d of descendants) {
			if (d.status === "queued" || d.status === "running") {
				this.cancel(d.id);
				count++;
			}
		}
		return count;
	}

	// ─── Private: concurrency key resolution ───────────────────────────────

	/**
	 * Resolve the concurrency limit for a given key.
	 * Lookup order: modelConcurrency → providerConcurrency → defaultConcurrency.
	 */
	private getConcurrencyLimit(key: string): number {
		// Try exact model match
		const modelLimit = this.config.modelConcurrency?.[key];
		if (modelLimit !== undefined) return modelLimit;

		// Try provider match (first segment before "/")
		const provider = key.split("/")[0];
		if (provider !== key) {
			const providerLimit = this.config.providerConcurrency?.[provider];
			if (providerLimit !== undefined) return providerLimit;
		}

		return this.config.defaultConcurrency;
	}

	/**
	 * Derive a concurrency key from a model string.
	 * If the model contains "/" (e.g. "anthropic/claude-sonnet-4-20250514"), use it as-is.
	 * Otherwise use the model id directly.
	 */
	private deriveConcurrencyKey(model: string): string {
		return model;
	}

	// ─── Private: drain ────────────────────────────────────────────────────

	/**
	 * Pull queued jobs into running slots as capacity allows.
	 * Checks both total running count and per-key limits.
	 */
	private drain(): void {
		let i = 0;
		while (i < this.queue.length) {
			const job = this.queue[i];
			const key = job.concurrencyKey;
			const limit = this.getConcurrencyLimit(key);
			const runningForKey = this.countRunningForKey(key);

			if (runningForKey < limit) {
				this.queue.splice(i, 1);
				job.status = "running";
				job.startedAt = Date.now();
				this.running.set(job.id, job);
				this.startStaleTimer(job.id);

				const runner = job.runner!;
				const signal = job.abortController!.signal;
				runner(signal).then(
					(result) => this.onComplete(job.id, result),
					(err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						this.onError(job.id, message);
					},
				);
				// Don't increment i — the array shifted
			} else {
				i++;
			}
		}
	}

	/**
	 * Count running jobs for a given concurrency key.
	 */
	private countRunningForKey(key: string): number {
		let count = 0;
		for (const job of this.running.values()) {
			if (job.concurrencyKey === key) count++;
		}
		return count;
	}

	// ─── Stale timeout ─────────────────────────────────────────────────────

	/**
	 * Reset the stale timer for a running job.
	 * Call this whenever the job makes progress (e.g. tool call events)
	 * to prevent premature stale-timeout cancellation.
	 */
	resetStaleTimer(jobId: string): void {
		if (this.config.staleTimeoutMs <= 0) return;
		const existing = this.staleTimers.get(jobId);
		if (!existing) return; // job not running or already completed
		clearTimeout(existing);
		this.staleTimers.delete(jobId);
		this.startStaleTimer(jobId);
	}

	private startStaleTimer(jobId: string): void {
		if (this.config.staleTimeoutMs <= 0) return;
		const timer = setTimeout(() => {
			this.staleTimers.delete(jobId);
			const job = this.running.get(jobId);
			if (job && job.status === "running") {
				job.abortController?.abort();
				this.onError(jobId, `Stale timeout: no progress for ${this.config.staleTimeoutMs / 1000}s`);
			}
		}, this.config.staleTimeoutMs);
		timer.unref?.();
		this.staleTimers.set(jobId, timer);
	}

	private clearStaleTimer(jobId: string): void {
		const timer = this.staleTimers.get(jobId);
		if (timer) {
			clearTimeout(timer);
			this.staleTimers.delete(jobId);
		}
	}

	// ─── Private: completion / error ───────────────────────────────────────

	/**
	 * Handle successful job completion.
	 */
	private onComplete(jobId: string, result: string): void {
		const job = this.running.get(jobId);
		if (!job) {
			// Job was cancelled while running — discard the result
			return;
		}
		job.status = "completed";
		job.result = result;
		delete job.runner;
		delete job.abortController;
		this.running.delete(jobId);
		this.clearStaleTimer(jobId);
		this.completed.set(jobId, job);
		this.evictOldest();

		try {
			this.onJobDone?.(this.sanitizeJob(job));
		} catch {
			// Notification failure must not break the drain loop
		}

		this.drain();
		this.notifyStatusChange();
	}

	/**
	 * Handle job failure.
	 */
	private onError(jobId: string, error: string): void {
		const job = this.running.get(jobId);
		if (!job) {
			// Job was cancelled while running — discard the error
			return;
		}
		job.status = "error";
		job.error = error;
		delete job.runner;
		delete job.abortController;
		this.running.delete(jobId);
		this.clearStaleTimer(jobId);
		this.completed.set(jobId, job);
		this.evictOldest();

		try {
			this.onJobDone?.(this.sanitizeJob(job));
		} catch {
			// Notification failure must not break the drain loop
		}

		this.drain();
		this.notifyStatusChange();
	}

	// ─── Private: status notification ─────────────────────────────────────

	/** Fire the onStatusChange callback with current counts. */
	private notifyStatusChange(): void {
		try {
			this.onStatusChange?.(this.getActiveCounts());
		} catch {
			// Must not break internal state transitions
		}
	}

	// ─── Private: helpers ──────────────────────────────────────────────────

	/**
	 * Evict oldest completed jobs when the map exceeds maxCompleted.
	 * Map iteration order is insertion order, so keys().next() gives the oldest.
	 */
	private evictOldest(): void {
		while (this.completed.size > this.config.maxCompleted) {
			const oldest = this.completed.keys().next().value;
			if (oldest !== undefined) {
				this.completed.delete(oldest);
			} else {
				break;
			}
		}
	}

	/**
	 * Return a copy of a Job without internal fields (runner, abortController).
	 */
	private sanitizeJob(job: Job): Job {
		const { runner: _, abortController: _ac, ...rest } = job;
		return rest;
	}

	/**
	 * Raw (unsanitized) children lookup for internal use.
	 */
	private getChildrenRaw(jobId: string): Job[] {
		return [...this.running.values(), ...this.queue, ...this.completed.values()]
			.filter((j) => j.parentJobId === jobId);
	}

	/**
	 * Raw (unsanitized) all-descendants lookup for internal use.
	 */
	private getAllDescendantsRaw(jobId: string): Job[] {
		const result: Job[] = [];
		const visited = new Set<string>();
		const stack = [jobId];
		visited.add(jobId);
		while (stack.length > 0) {
			const id = stack.pop()!;
			const children = this.getChildrenRaw(id);
			for (const child of children) {
				if (visited.has(child.id)) continue;
				visited.add(child.id);
				result.push(child);
				stack.push(child.id);
			}
		}
		return result;
	}
}
