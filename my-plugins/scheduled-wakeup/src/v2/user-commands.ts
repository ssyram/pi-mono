import type { ActiveTask, SharedDefinition, SharedDeleteResult, SharedScope, TaskInput } from "./model.js";
import { type CancellationResult, LoopV2Core } from "./loop-core.js";

/** The future slash-command adapter owns this surface; AI tool adapters do not receive it. */
export class UserLoopV2Commands {
	private readonly core: LoopV2Core;

	constructor(core: LoopV2Core) { this.core = core; }

	addSessionTask(input: TaskInput) { return this.core.createSessionTask(input); }
	defineSharedTask(scope: SharedScope, input: TaskInput): SharedDefinition { return this.core.createSharedDefinition(scope, input); }
	registerSharedTask(scope: SharedScope, definitionId: string) { return this.core.registerSharedDefinition(scope, definitionId); }
	unregisterSharedTask(registrationId: string): CancellationResult { return this.core.unregisterSharedDefinition(registrationId); }
	cancelSessionTask(taskId: string): CancellationResult { return this.core.cancelSessionTask(taskId); }
	deleteSharedTask(scope: SharedScope, definitionId: string, force = false): SharedDeleteResult { return this.core.deleteSharedDefinition(scope, definitionId, force); }
	listActive(): readonly ActiveTask[] { return this.core.listActive(); }
	listAvailable(scopes?: readonly SharedScope[]): readonly SharedDefinition[] { return scopes === undefined ? this.core.listAvailable() : this.core.listAvailable(scopes); }
}
