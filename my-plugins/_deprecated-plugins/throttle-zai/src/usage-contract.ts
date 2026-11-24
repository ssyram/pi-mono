/** E2 provider-usage query contract mirror (subset this plugin produces). Swap to the
 * provider-usage public module once E2 lands (docs/extern-dep-design.md#e2-provider-usage). */

export const PROVIDER_USAGE_QUERY = "provider-usage:query:v1";

export type UsageErrorCode =
	| "auth"
	| "timeout"
	| "network"
	| "http"
	| "invalid-response"
	| "configuration";

export type UsageQueryResult =
	| { kind: "available"; compact: string; text: string }
	| { kind: "error"; code: UsageErrorCode; message?: string }
	| { kind: "cancelled" };

export interface UsageSelectionIdentity {
	readonly providerId: string;
	readonly modelId: string;
	readonly api: string;
	readonly endpoint: string;
}

export interface ProviderUsageRequest {
	readonly session: object;
	readonly selection: UsageSelectionIdentity;
	readonly nativeProvider: unknown;
	readonly signal: AbortSignal;
	accept(result: Promise<UsageQueryResult>): void;
}
