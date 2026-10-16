import { describeThrown } from "./describe-error.ts";
import {
	BOULDER_INHIBITION_SERVICE_CHANNEL,
	type BoulderClientResult,
	type BoulderInhibitionClient,
	type BoulderInhibitionEventBus,
	type BoulderInhibitionOperation,
	type BoulderInhibitionServiceRequest,
	type BoulderInhibitionServiceResponse,
} from "./service-protocol.ts";

export function createBoulderInhibitionClient(
	bus: BoulderInhibitionEventBus,
	session: object,
): BoulderInhibitionClient {
	function invoke(operation: BoulderInhibitionOperation): BoulderClientResult {
		const response: { value?: BoulderInhibitionServiceResponse } = {};
		const request: BoulderInhibitionServiceRequest = {
			...operation,
			session,
			reply(result) {
				if (response.value === undefined) response.value = result;
			},
		};
		try {
			bus.emit(BOULDER_INHIBITION_SERVICE_CHANNEL, request);
			const result = response.value;
			if (result === undefined) {
				return { ok: false, failure: { message: "Boulder inhibition service unavailable" } };
			}
			return result.ok ? result : { ok: false, failure: result.failure };
		} catch (error) {
			return { ok: false, failure: { message: describeThrown(error), cause: error } };
		}
	}
	return {
		get: () => invoke({ op: "get" }),
		set: (signal) => invoke({ op: "set", signal }),
	};
}
