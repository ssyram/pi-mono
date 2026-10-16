import { parseBoulderInhibitSignal } from "./parse-signal.ts";
import { describeThrown } from "./describe-error.ts";
import { reportBoulderDiagnostic } from "./report-error.ts";
import { readBoulderInhibition } from "./read-inhibition.ts";
import {
	BOULDER_INHIBITION_SERVICE_CHANNEL,
	type BoulderInhibitionEventBus,
	type BoulderInhibitionOperation,
	type BoulderInhibitionServiceResponse,
	type BoulderInhibitionSessionResolver,
} from "./service-protocol.ts";
import { writeBoulderInhibition } from "./write-inhibition.ts";

export function registerBoulderInhibitionService(
	bus: BoulderInhibitionEventBus,
	resolveSession: BoulderInhibitionSessionResolver,
): () => void {
	return bus.on(BOULDER_INHIBITION_SERVICE_CHANNEL, (data) => {
		let reply: ((result: BoulderInhibitionServiceResponse) => void) | undefined;
		let result: BoulderInhibitionServiceResponse;
		try {
			if (typeof data !== "object" || data === null || Array.isArray(data)) return;
			if (!("reply" in data) || typeof data.reply !== "function") return;
			reply = data.reply as (result: BoulderInhibitionServiceResponse) => void;
			result = handleRequest(data, resolveSession);
		} catch (error) {
			result = {
				ok: false,
				failure: { message: `Boulder inhibition service handler failed: ${describeThrown(error)}`, cause: error },
			};
		}
		if (reply === undefined) return;
		try {
			reply(result);
		} catch (error) {
			reportBoulderDiagnostic(`[boulder-inhibition] reply failed: ${describeThrown(error)}`);
		}
	});
}

function handleRequest(
	data: Record<string, unknown>,
	resolveSession: BoulderInhibitionSessionResolver,
): BoulderInhibitionServiceResponse {
	if (
		!("session" in data) || typeof data.session !== "object" || data.session === null || Array.isArray(data.session) ||
		!("op" in data) || (data.op !== "get" && data.op !== "set")
	) {
		return { ok: false, failure: { message: "Invalid Boulder inhibition service request" } };
	}
	let operation: BoulderInhibitionOperation;
	if (data.op === "set") {
		const signal = parseBoulderInhibitSignal("signal" in data ? data.signal : undefined);
		if (signal === undefined) {
			return { ok: false, failure: { message: "Invalid Boulder inhibition service request" } };
		}
		operation = { op: "set", signal };
	} else {
		operation = { op: "get" };
	}
	try {
		const binding = resolveSession(data.session);
		if (binding === undefined) {
			return { ok: false, failure: { message: "Boulder inhibition session unavailable" } };
		}
		const snapshot = operation.op === "get"
			? readBoulderInhibition(binding.port.getBranch())
			: writeBoulderInhibition(binding.port, binding.effects, operation.signal);
		return { ok: true, snapshot };
	} catch (error) {
		return { ok: false, failure: { message: describeThrown(error), cause: error } };
	}
}
