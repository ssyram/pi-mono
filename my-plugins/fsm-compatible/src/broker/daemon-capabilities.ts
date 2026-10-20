import { isDataArray } from "../admission/data-array.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { DaemonReply } from "./daemon-request.ts";

export const MIN_WIRE_CONTRACT_VERSION = 2;

export interface DaemonCapabilities {
	readonly serverVersion: string;
	readonly wireContractVersion: number;
	readonly skillSchemaVersion: number;
	readonly features: readonly string[];
}

export function requireDaemonCapabilities(reply: DaemonReply): DaemonCapabilities {
	const body = reply.body;
	if (reply.status !== 200 || !isAdmissionObject(body) || typeof body.server_version !== "string"
		|| !body.server_version
		|| typeof body.wire_contract_version !== "number" || body.wire_contract_version < MIN_WIRE_CONTRACT_VERSION
		|| typeof body.skill_schema_version !== "number" || body.skill_schema_version < 2
		|| !isDataArray(body.features)) throw new RuntimeError("not-ready");
	const features = body.features;
	if (!features.every((item): item is string => typeof item === "string" && item.length > 0)
		|| new Set(features).size !== features.length) throw new RuntimeError("not-ready");
	if (!["dispatch_state_admission_v1", "typed_input_exact_v1"].every((name) => features.includes(name))) {
		throw new RuntimeError("not-ready");
	}
	return Object.freeze({ serverVersion: body.server_version, wireContractVersion: body.wire_contract_version, skillSchemaVersion: body.skill_schema_version,
		features: Object.freeze([...features]) });
}
