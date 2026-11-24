/** E2 usage service: claim only owned instances; read-only; no daemon start; no fallback. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FailureCode } from "./backend-failure.js";
import type { BackendOwner } from "./backend-owner.js";
import { aggregatePool } from "./pool-usage.js";
import { formatPoolUsage } from "./usage-format.js";
import { PROVIDER_USAGE_QUERY, type ProviderUsageRequest, type UsageErrorCode, type UsageQueryResult } from "./usage-contract.js";
import type { QuotaPolicy } from "./plugin-config.js";

const CODE_MAP: Partial<Record<FailureCode, UsageErrorCode>> = {
	"startup-timeout": "timeout",
	timeout: "timeout",
	"not-ready": "network",
	network: "network",
	http: "http",
	"invalid-response": "invalid-response",
	"management-auth": "auth",
	"client-disabled": "auth",
};

function toQueryResult(code: FailureCode): UsageQueryResult {
	const mapped = CODE_MAP[code];
	if (mapped === undefined) return { kind: "error", code: "configuration", message: "throttle-zai backend is not usable" };
	if (mapped === "configuration") return { kind: "error", code: "configuration", message: "throttle-zai configuration is invalid" };
	return { kind: "error", code: mapped };
}

export function registerUsageService(pi: Pick<ExtensionAPI, "events">, owner: BackendOwner, policy: QuotaPolicy): void {
	pi.events.on(PROVIDER_USAGE_QUERY, (data) => {
		const request = data as ProviderUsageRequest;
		if (!owner.owns(request.nativeProvider, request.selection)) return;
		request.accept(runQuery(owner, policy, request.signal));
	});
}

async function runQuery(owner: BackendOwner, policy: QuotaPolicy, signal: AbortSignal): Promise<UsageQueryResult> {
	let snapshot;
	try {
		snapshot = await owner.readOwnedSnapshot(signal);
	} catch (error) {
		if (signal.aborted) return { kind: "cancelled" };
		return { kind: "error", code: "network", message: "usage query failed" };
	}
	if (snapshot.kind === "cancelled") return { kind: "cancelled" };
	if (snapshot.kind === "error") return toQueryResult(snapshot.code);
	if (snapshot.value.dryRun) {
		return { kind: "error", code: "configuration", message: "backend is in dry-run mode" };
	}
	if (snapshot.value.unmanagedChannelIds.length > 0) {
		return { kind: "error", code: "configuration", message: "unmanaged channel in routing group" };
	}
	const usage = aggregatePool(snapshot.value, policy);
	return { kind: "available", ...formatPoolUsage(usage) };
}
