import type { BoulderInhibitionEffects } from "../../boulder-inhibition/protocol.ts";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import { registerBoulderInhibitionService } from "../../boulder-inhibition/service.ts";
import { InMemoryBranch } from "./in-memory-branch.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

export function sessionBoundService(branch: InMemoryBranch, effects: BoulderInhibitionEffects) {
	const bus = new SynchronousEventBus();
	const session = {};
	const resolvedSessions: object[] = [];
	const dispose = registerBoulderInhibitionService(bus, (requested) => {
		resolvedSessions.push(requested);
		return requested === session ? { port: branch, effects } : undefined;
	});
	const client = createBoulderInhibitionClient(bus, session);
	return { bus, session, resolvedSessions, client, dispose };
}
