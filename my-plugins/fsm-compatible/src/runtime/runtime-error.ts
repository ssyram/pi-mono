export const RUNTIME_ERROR_CODES = [
	"not-ready", "owner-unavailable", "queue-full", "deadline-exceeded",
	"transport-failed", "protocol-invalid", "delivery-unknown", "cancelled",
] as const;
export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export class RuntimeError extends Error {
	readonly code: RuntimeErrorCode;
	constructor(code: RuntimeErrorCode) {
		super(code);
		this.name = "RuntimeError";
		this.code = code;
	}
}
