import {
	cloneRegistration,
	initialProgress,
	type ExecutionProgress,
	type Registration,
	type SharedDefinition,
} from "./model.js";
import { SessionEntryAdapter } from "./session-entry-adapter.js";

export class RegistrationStore {
	private readonly sessionState: SessionEntryAdapter;

	constructor(sessionState: SessionEntryAdapter) {
		this.sessionState = sessionState;
	}

	reload(): void {
		this.sessionState.reload();
	}

	list(): readonly Registration[] {
		return this.sessionState.snapshot().registrations.map(cloneRegistration);
	}

	find(id: string): Registration | undefined {
		const registration = this.sessionState.snapshot().registrations.find((item) => item.id === id);
		return registration === undefined ? undefined : cloneRegistration(registration);
	}

	prepare(definition: SharedDefinition, now: number): Registration {
		const existing = this.sessionState.snapshot().registrations.find(
			(item) => item.reference.scope === definition.scope && item.reference.definitionId === definition.id,
		);
		if (existing !== undefined) return cloneRegistration(existing);
		return {
			id: `registration:${definition.scope}:${definition.id}`,
			reference: { scope: definition.scope, definitionId: definition.id },
			progress: initialProgress(definition.schedule, now),
			registeredAt: now,
		};
	}

	persist(registration: Registration): Registration {
		if (this.find(registration.id) === undefined) this.sessionState.dispatch({ kind: "add-registration", registration });
		return cloneRegistration(registration);
	}

	unregister(id: string): boolean {
		if (this.find(id) === undefined) return false;
		this.sessionState.dispatch({ kind: "remove-registration", registrationId: id });
		return true;
	}

	removeDefinition(scope: Registration["reference"]["scope"], definitionId: string): readonly Registration[] {
		const matches = this.list().filter((item) => item.reference.scope === scope && item.reference.definitionId === definitionId);
		for (const registration of matches) this.sessionState.dispatch({ kind: "remove-registration", registrationId: registration.id });
		return matches;
	}

	advance(id: string, progress: ExecutionProgress): Registration {
		this.sessionState.dispatch({ kind: "advance-registration", registrationId: id, progress });
		const registration = this.find(id);
		if (registration === undefined) throw new Error(`Registration ${id} disappeared while advancing`);
		return registration;
	}
}
