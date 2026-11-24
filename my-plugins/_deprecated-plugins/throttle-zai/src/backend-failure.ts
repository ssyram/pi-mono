/** Backend failure taxonomy: fixed codes, no raw payloads, no secrets. See docs/design/*.md. */

export type FailureCode =
	| "configuration"
	| "unsupported-backend"
	| "uninitialized"
	| "not-ready"
	| "identity-conflict"
	| "startup-timeout"
	| "timeout"
	| "network"
	| "http"
	| "invalid-response"
	| "management-auth"
	| "quota-probe"
	| "relay-policy"
	| "ambiguous-write"
	| "operation-uncertain"
	| "client-disabled"
	| "storage";

export interface BackendFailure {
	kind: "error";
	code: FailureCode;
	httpStatus?: number;
	operation?: string;
}

export type BackendResult<T> = { kind: "ok"; value: T } | BackendFailure | { kind: "cancelled" };

const MESSAGES: Record<FailureCode, string> = {
	configuration: "invalid throttle-zai configuration",
	"unsupported-backend": "quota-throttle binary does not support the required service contract",
	uninitialized: "throttle-zai backend has not been initialized; run /add-login first",
	"not-ready": "throttle-zai backend is still starting",
	"identity-conflict": "existing backend does not match this installation",
	"startup-timeout": "throttle-zai backend did not become ready in time",
	timeout: "operation timed out",
	network: "backend is unreachable",
	http: "backend returned an unexpected HTTP response",
	"invalid-response": "backend returned malformed data",
	"management-auth": "managed new-api rejected the management credential",
	"quota-probe": "Zhipu quota probe rejected the account",
	"relay-policy": "managed relay policy is not satisfied",
	"ambiguous-write": "write result is unknown; manual reconciliation required",
	"operation-uncertain": "operation result is unknown; manual reconciliation required",
	"client-disabled": "gateway client token exists but is disabled",
	storage: "local plugin state could not be read or written",
};

export function backendFailure(code: FailureCode, operation?: string, httpStatus?: number): BackendFailure {
	return { kind: "error", code, ...(operation ? { operation } : {}), ...(httpStatus ? { httpStatus } : {}) };
}

export function failureMessage(failure: BackendFailure): string {
	const base = MESSAGES[failure.code];
	const op = failure.operation ? ` (${failure.operation})` : "";
	const status = failure.httpStatus ? ` [HTTP ${failure.httpStatus}]` : "";
	return `${base}${op}${status}`;
}

/** SDK rejection boundary: cancelled -> AbortError, everything else -> controlled Error. */
export function toProviderError(failure: BackendFailure | { kind: "cancelled" }): Error {
	if (failure.kind === "cancelled") return new DOMException("aborted", "AbortError");
	return new Error(failureMessage(failure));
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
