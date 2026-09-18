import { SharedDefinitionStore } from "./definition-store.js";
import { advanceProgress, isDue, type ExecutionResult, type ExecutionTarget, type Registration, type SharedDefinition } from "./model.js";
import { RegistrationExecutionLock } from "./registration-execution-lock.js";
import { RegistrationStore } from "./registration-store.js";

export type DeliverTask = (target: ExecutionTarget) => void;

export class RegistrationExecutor {
	private readonly definitions: SharedDefinitionStore;
	private readonly registrations: RegistrationStore;
	private readonly locks: RegistrationExecutionLock;
	private readonly now: () => number;
	private readonly sessionId: string;

	constructor(definitions: SharedDefinitionStore, registrations: RegistrationStore, locks: RegistrationExecutionLock, now: () => number, sessionId: string) {
		this.definitions = definitions;
		this.registrations = registrations;
		this.locks = locks;
		this.now = now;
		this.sessionId = sessionId;
	}

	execute(registrationId: string, deliver: DeliverTask): ExecutionResult {
		const executionLock = this.locks.tryAcquire(`registration:${registrationId}`);
		if (executionLock === undefined) return { kind: "locked", id: registrationId };
		try {
			const stateLock = this.locks.tryAcquire("state");
			if (stateLock === undefined) return { kind: "locked", id: registrationId };
			try {
				this.registrations.reload();
				const registration = this.registrations.find(registrationId);
				if (registration === undefined) return { kind: "missing", id: registrationId };
				const index = { ...registration.reference, sessionId: this.sessionId, registrationId: registration.id, registeredAt: registration.registeredAt };
				const definition = this.definitions.get(registration.reference.scope, registration.reference.definitionId);
				if (definition === undefined || !this.definitions.isIndexed(index)) return { kind: "unavailable", id: registrationId };
				if (!isDue(registration.progress, this.now())) return { kind: "not-due", id: registrationId };
				const failed = this.deliver(registration, definition, deliver);
				if (failed !== undefined) return failed;
				if (executionLock.compromised() || stateLock.compromised()) return { kind: "compromised", id: registrationId };
				const updated = this.registrations.advance(registrationId, advanceProgress(registration.progress, definition.schedule, this.now()));
				return executionLock.compromised() || stateLock.compromised()
					? { kind: "compromised", id: registrationId }
					: { kind: "executed", id: registrationId, runCount: updated.progress.runCount };
			} catch (error) {
				return { kind: "failed", id: registrationId, message: errorMessage(error) };
			} finally { stateLock.release(); }
		} finally { executionLock.release(); }
	}

	private deliver(registration: Registration, definition: SharedDefinition, deliver: DeliverTask): ExecutionResult | undefined {
		try {
			deliver({ id: registration.id, scope: definition.scope, prompt: definition.prompt });
			return undefined;
		} catch (error) {
			return { kind: "failed", id: registration.id, message: errorMessage(error) };
		}
	}
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
