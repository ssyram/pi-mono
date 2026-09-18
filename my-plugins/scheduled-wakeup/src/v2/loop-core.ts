import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SharedDefinitionStore } from "./definition-store.js";
import {
	assertTaskInput,
	cloneDefinition,
	cloneSessionState,
	initialProgress,
	isDue,
	type ActiveTask,
	type ExecutionResult,
	type Registration,
	type SessionDefinition,
	type SessionLoopState,
	type SharedDefinition,
	type SharedDeleteResult,
	type SharedRegistrationIndex,
	type SharedScope,
	type TaskInput,
} from "./model.js";
import { RegistrationExecutionLock } from "./registration-execution-lock.js";
import { RegistrationExecutor, type DeliverTask } from "./registration-executor.js";
import { RegistrationStore } from "./registration-store.js";
import { SessionEntryAdapter, type SessionEntryPort } from "./session-entry-adapter.js";
import { SessionTaskExecutor } from "./session-task-executor.js";

export type LoopV2CoreOptions = {
	sessionId: string; sessionEntries: SessionEntryPort; workspaceRoot: string; globalRoot: string;
	lockRoot?: string; now?: () => number; idFactory?: () => string;
};
export type CancellationResult = "cancelled" | "missing" | "busy";
type StateLockAttempt<T> = { acquired: true; value: T } | { acquired: false };

export class LoopV2Core {
	private readonly sessionState: SessionEntryAdapter;
	private readonly definitions: SharedDefinitionStore;
	private readonly registrations: RegistrationStore;
	private readonly locks: RegistrationExecutionLock;
	private readonly registrationExecutor: RegistrationExecutor;
	private readonly sessionTaskExecutor: SessionTaskExecutor;
	private readonly now: () => number;
	private readonly idFactory: () => string;
	private readonly sessionId: string;

	constructor(options: LoopV2CoreOptions) {
		this.sessionId = options.sessionId;
		this.now = options.now ?? Date.now;
		this.idFactory = options.idFactory ?? randomUUID;
		this.sessionState = new SessionEntryAdapter(options.sessionEntries);
		this.definitions = new SharedDefinitionStore(options.workspaceRoot, options.globalRoot);
		this.registrations = new RegistrationStore(this.sessionState);
		this.locks = new RegistrationExecutionLock(options.lockRoot ?? join(options.workspaceRoot, ".pi", "scheduled-wakeup", "v2", "locks"), options.sessionId);
		this.registrationExecutor = new RegistrationExecutor(this.definitions, this.registrations, this.locks, this.now, this.sessionId);
		this.sessionTaskExecutor = new SessionTaskExecutor(this.sessionState, this.locks, this.now);
	}

	createSessionTask(input: TaskInput): SessionDefinition {
		return this.withStateLock(() => {
			assertTaskInput(input);
			const definition: SessionDefinition = { id: `session:${this.idFactory()}`, scope: "session", prompt: input.prompt.trim(), schedule: { ...input.schedule }, createdAt: this.currentNow() };
			this.sessionState.dispatch({ kind: "add-task", task: { definition, progress: initialProgress(definition.schedule, definition.createdAt) } });
			return cloneDefinition(definition);
		});
	}

	createSharedDefinition(scope: SharedScope, input: TaskInput): SharedDefinition {
		assertTaskInput(input);
		const definition: SharedDefinition = { id: `${scope}:${this.idFactory()}`, scope, prompt: input.prompt.trim(), schedule: { ...input.schedule }, createdAt: this.currentNow() };
		return this.definitions.create(definition);
	}

	registerSharedDefinition(scope: SharedScope, definitionId: string): Registration {
		return this.withStateLock(() => {
			const definition = this.definitions.get(scope, definitionId);
			if (definition === undefined) throw new Error(`Shared definition ${scope}:${definitionId} does not exist`);
			const registration = this.registrations.prepare(definition, this.currentNow());
			if (this.definitions.indexRegistration(this.indexOf(registration)) === "missing") throw new Error(`Shared definition ${definitionId} disappeared`);
			return this.registrations.persist(registration);
		});
	}

	unregisterSharedDefinition(registrationId: string): CancellationResult {
		return this.withRegistrationLock(registrationId, () => {
			const attempt = this.tryWithStateLock(() => {
				const registration = this.registrations.find(registrationId);
				if (registration === undefined) return "missing";
				this.registrations.unregister(registrationId);
				this.definitions.removeRegistration(this.indexOf(registration));
				return "cancelled";
			});
			return attempt.acquired ? attempt.value : "busy";
		});
	}

	cancelActive(id: string): CancellationResult {
		this.sessionState.reload();
		return this.sessionState.snapshot().tasks.some((task) => task.definition.id === id) ? this.cancelSessionTask(id) : this.unregisterSharedDefinition(id);
	}

	cancelSessionTask(taskId: string): CancellationResult {
		const lock = this.locks.tryAcquire(`task:${taskId}`);
		if (lock === undefined) return "busy";
		try {
			const attempt = this.tryWithStateLock(() => {
				if (!this.sessionState.snapshot().tasks.some((task) => task.definition.id === taskId)) return "missing";
				this.sessionState.dispatch({ kind: "remove-task", taskId }); return "cancelled";
			});
			return attempt.acquired ? attempt.value : "busy";
		} finally { lock.release(); }
	}

	deleteSharedDefinition(scope: SharedScope, definitionId: string, force = false): SharedDeleteResult {
		this.sessionState.reload();
		const registration = this.registrations.list().find((item) => item.reference.scope === scope && item.reference.definitionId === definitionId);
		if (registration === undefined) return this.deleteWithState(scope, definitionId, force);
		return this.withRegistrationLockResult(registration.id, () => this.deleteWithState(scope, definitionId, force));
	}

	deleteRegistrationDefinition(registrationId: string): SharedDeleteResult {
		this.sessionState.reload();
		const registration = this.registrations.find(registrationId);
		return registration === undefined ? { kind: "missing" } : this.deleteSharedDefinition(registration.reference.scope, registration.reference.definitionId);
	}

	reconcileSharedRegistrations(): readonly string[] {
		return this.withStateLock(() => {
			const stale = this.registrations.list().filter((registration) => this.definitions.registrationStatus(this.indexOf(registration)) === "missing");
			for (const registration of stale) this.registrations.unregister(registration.id);
			return stale.map((registration) => registration.id);
		});
	}

	listActive(): readonly ActiveTask[] {
		this.sessionState.reload();
		const state = this.sessionState.snapshot();
		const active: ActiveTask[] = state.tasks.filter((task) => task.progress.status === "active").map((task) => ({ kind: "session", task }));
		for (const registration of state.registrations) if (registration.progress.status === "active") active.push({ kind: "registration", registration, definition: this.definitions.get(registration.reference.scope, registration.reference.definitionId) });
		return active;
	}

	listAvailable(scopes: readonly SharedScope[] = ["workspace", "global"]): readonly SharedDefinition[] {
		this.sessionState.reload();
		const registered = new Set(this.registrations.list().map((item) => `${item.reference.scope}:${item.reference.definitionId}`));
		return scopes.flatMap((scope) => this.definitions.list(scope).filter((definition) => !registered.has(`${scope}:${definition.id}`)));
	}

	executeRegistration(id: string, deliver: DeliverTask): ExecutionResult { return this.registrationExecutor.execute(id, deliver); }
	executeSessionTask(id: string, deliver: DeliverTask): ExecutionResult { return this.sessionTaskExecutor.execute(id, deliver); }
	runDue(deliver: DeliverTask): readonly ExecutionResult[] { return this.listActive().filter((item) => isDue(item.kind === "session" ? item.task.progress : item.registration.progress, this.currentNow())).map((item) => item.kind === "session" ? this.executeSessionTask(item.task.definition.id, deliver) : this.executeRegistration(item.registration.id, deliver)); }
	snapshotSessionState(): SessionLoopState { this.sessionState.reload(); return cloneSessionState(this.sessionState.snapshot()); }
	sharedDefinitionIds(scopes: readonly SharedScope[] = ["workspace", "global"]): readonly string[] { return this.definitionsIds(scopes); }
	activeIds(): readonly string[] { return this.listActive().map((item) => item.kind === "session" ? item.task.definition.id : item.registration.id); }

	private definitionsIds(scopes: readonly SharedScope[]): readonly string[] { return scopes.flatMap((scope) => this.definitions.list(scope).map((definition) => definition.id)); }
	private deleteWithState(scope: SharedScope, id: string, force: boolean): SharedDeleteResult {
		const attempt = this.tryWithStateLock(() => {
			const result = this.definitions.delete(scope, id, this.sessionId, force);
			if (result.kind === "deleted") this.registrations.removeDefinition(scope, id);
			return result;
		});
		return attempt.acquired ? attempt.value : { kind: "busy" };
	}
	private indexOf(registration: Registration): SharedRegistrationIndex { return { ...registration.reference, sessionId: this.sessionId, registrationId: registration.id, registeredAt: registration.registeredAt }; }
	private withRegistrationLock(id: string, work: () => CancellationResult): CancellationResult { const lock = this.locks.tryAcquire(`registration:${id}`); if (lock === undefined) return "busy"; try { return work(); } finally { lock.release(); } }
	private withRegistrationLockResult(id: string, work: () => SharedDeleteResult): SharedDeleteResult { const lock = this.locks.tryAcquire(`registration:${id}`); if (lock === undefined) return { kind: "busy" }; try { return work(); } finally { lock.release(); } }
	private withStateLock<T>(work: () => T): T { const attempt = this.tryWithStateLock(work); if (!attempt.acquired) throw new Error("Session loop state is busy"); return attempt.value; }
	private tryWithStateLock<T>(work: () => T): StateLockAttempt<T> { const lock = this.locks.tryAcquire("state"); if (lock === undefined) return { acquired: false }; try { this.sessionState.reload(); return { acquired: true, value: work() }; } finally { lock.release(); } }
	private currentNow(): number { const now = this.now(); if (!Number.isSafeInteger(now) || now <= 0) throw new Error("Clock must return a positive safe integer"); return now; }
}
