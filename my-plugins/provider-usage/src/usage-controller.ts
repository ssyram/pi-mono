import type { FooterSnapshot, UsageFooter } from "./footer-component.js";
import { route } from "./route.js";
import { captureSelection, sameSelection } from "./selection.js";
import { executeUsageQuery } from "./usage-query.js";
import { systemScheduler, type ActiveJob, type ControllerContext, type PendingJob, type UsageQueryRunner } from "./controller-contract.js";
import type { ContextUsageSnapshot, DisplayState, QueryResult, Selection, UsageModel, UsageModelRegistry } from "./usage-contract.js";

export class UsageController {
	readonly sessionManager: ControllerContext["sessionManager"];
	readonly modelRegistry: UsageModelRegistry;
	private readonly getContextUsageFromHost: () => ContextUsageSnapshot | undefined;
	private readonly scheduler;
	private readonly query: UsageQueryRunner;
	private selection: Selection | undefined;
	private model: UsageModel | undefined;
	private thinkingLevel: string | undefined;
	private generation = 0;
	private disposed = false;
	private display: DisplayState = { kind: "empty" };
	private activeJob: ActiveJob | undefined;
	private latestPending: PendingJob | undefined;
	private lastAttemptAt: number | undefined;
	private wakeTimer: { clear(): void } | undefined;
	private footer: UsageFooter | undefined;
	private requestRender: (() => void) | undefined;

	constructor(context: ControllerContext) {
		this.sessionManager = context.sessionManager;
		this.modelRegistry = context.modelRegistry;
		this.getContextUsageFromHost = context.getContextUsage;
		this.scheduler = context.scheduler ?? systemScheduler();
		this.query = context.query ?? executeUsageQuery;
	}

	getContextUsage(): ContextUsageSnapshot | undefined {
		return this.getContextUsageFromHost();
	}

	getFooterSnapshot(): FooterSnapshot {
		return { model: this.model, thinkingLevel: this.thinkingLevel, display: this.display };
	}

	attachFooter(footer: UsageFooter, requestRender: () => void): void {
		if (this.disposed) {
			footer.dispose();
			return;
		}
		this.footer?.dispose();
		this.footer = footer;
		this.requestRender = requestRender;
	}

	requestRefresh(model: UsageModel | undefined, modelSelected = false): void {
		if (this.disposed) return;
		this.model = model;
		const nextSelection = captureSelection(this, model);
		const changed = modelSelected || !sameSelection(this.selection, nextSelection);
		if (changed) this.replaceSelection(nextSelection);
		else this.selection = nextSelection;
		if (!nextSelection) return this.publishEmpty();
		const nextRoute = route(nextSelection);
		if (nextRoute.kind === "error") return this.publishResult(nextSelection, { kind: "error", code: nextRoute.code });
		if (nextRoute.kind === "unsupported") return this.publishResult(nextSelection, { kind: "unsupported" });
		this.latestPending = { selection: nextSelection, route: nextRoute, generation: this.generation };
		if (!this.hasCurrentDisplay(nextSelection)) {
			this.display = { kind: "loading", selection: nextSelection };
			this.render();
		}
		if (this.activeJob) return this.publishTimeoutWhenCurrent(nextSelection);
		this.startOrSchedule();
	}

	updateThinkingLevel(level: string): void {
		if (this.disposed) return;
		this.thinkingLevel = level;
		this.render();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.clearWakeTimer();
		if (this.activeJob) {
			this.activeJob.deadline.clear();
			this.activeJob.abort.abort();
		}
		this.latestPending = undefined;
		this.display = { kind: "empty" };
		this.footer?.dispose();
		this.footer = undefined;
		this.requestRender = undefined;
	}

	private publishEmpty(): void {
		this.latestPending = undefined;
		this.clearWakeTimer();
		this.display = { kind: "empty" };
		this.render();
	}

	private publishResult(selection: Selection, result: Exclude<QueryResult, { kind: "cancelled" }>): void {
		this.latestPending = undefined;
		this.clearWakeTimer();
		this.setReady(selection, result);
	}

	private setReady(selection: Selection, result: Exclude<QueryResult, { kind: "cancelled" }>): void {
		const previous = this.display;
		this.display = result.kind === "error" && previous.kind === "ready" &&
			previous.result.kind === "available" && sameSelection(previous.selection, selection)
			? { kind: "ready", selection, result: previous.result, staleError: result.code }
			: { kind: "ready", selection, result };
		this.render();
	}

	private publishTimeoutWhenCurrent(selection: Selection): void {
		if (this.activeJob?.timedOut && this.activeJob.generation === this.generation) {
			this.setReady(selection, { kind: "error", code: "timeout" });
		}
	}

	private hasCurrentDisplay(selection: Selection): boolean {
		return this.display.kind === "ready" && sameSelection(this.display.selection, selection);
	}

	private replaceSelection(selection: Selection | undefined): void {
		this.generation += 1;
		this.selection = selection;
		this.display = { kind: "empty" };
		this.latestPending = undefined;
		this.lastAttemptAt = undefined;
		this.clearWakeTimer();
		this.activeJob?.abort.abort();
	}

	private startOrSchedule(): void {
		if (this.disposed || this.activeJob || !this.latestPending) return;
		const elapsed = this.lastAttemptAt === undefined ? Number.POSITIVE_INFINITY : this.scheduler.now() - this.lastAttemptAt;
		if (elapsed >= 60_000) return this.startJob();
		if (!this.wakeTimer) {
			this.wakeTimer = this.scheduler.after(Math.max(0, 60_000 - elapsed), () => {
				this.wakeTimer = undefined;
				this.startOrSchedule();
			});
		}
	}

	private startJob(): void {
		const pending = this.latestPending;
		if (this.disposed || this.activeJob || !pending) return;
		this.latestPending = undefined;
		this.lastAttemptAt = this.scheduler.now();
		const job: ActiveJob = {
			...pending,
			abort: new AbortController(),
			deadline: { clear: () => {} },
			timedOut: false,
			result: undefined,
		};
		this.activeJob = job;
		job.deadline = this.scheduler.after(15_000, () => this.onDeadline(job));
		if (!this.hasCurrentDisplay(job.selection)) {
			this.display = { kind: "loading", selection: job.selection };
			this.render();
		}
		void this.query(job.selection, job.route, this.modelRegistry, job.abort.signal)
			.then((result) => {
				job.result = result;
			})
			.catch(() => {
				job.result = { kind: "error", code: "network" };
			})
			.finally(() => this.finishJob(job));
	}

	private onDeadline(job: ActiveJob): void {
		if (this.disposed || this.activeJob !== job) return;
		job.timedOut = true;
		job.abort.abort();
		if (job.generation === this.generation) this.setReady(job.selection, { kind: "error", code: "timeout" });
	}

	private finishJob(job: ActiveJob): void {
		job.deadline.clear();
		if (this.activeJob === job) this.activeJob = undefined;
		const result: QueryResult = job.result ?? { kind: "error", code: "network" };
		const superseded = this.latestPending?.generation === this.generation;
		if (
			!this.disposed &&
			job.generation === this.generation &&
			!job.timedOut &&
			!job.abort.signal.aborted &&
			result.kind !== "cancelled" &&
			!superseded
		) {
			this.setReady(job.selection, result);
		}
		if (!this.disposed && this.latestPending) this.startOrSchedule();
	}

	private clearWakeTimer(): void {
		this.wakeTimer?.clear();
		this.wakeTimer = undefined;
	}

	private render(): void {
		this.requestRender?.();
	}
}
