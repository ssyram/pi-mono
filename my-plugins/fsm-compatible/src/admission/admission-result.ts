export const ADMISSION_ERROR_CODES = [
	"invalid-input",
	"agent-not-admitted",
	"runner-not-admitted",
	"required-extension-mismatch",
	"policy-widened",
	"binding-mismatch",
	"parent-not-found",
	"parent-cycle",
	"depth-exceeded",
	"restore-conflict",
] as const;

export type AdmissionErrorCode = (typeof ADMISSION_ERROR_CODES)[number];
export type AdmissionResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly code: AdmissionErrorCode };

export function admitted<T>(value: T): AdmissionResult<T> {
	return Object.freeze({ ok: true, value });
}

export function rejected(code: AdmissionErrorCode): AdmissionResult<never> {
	return Object.freeze({ ok: false, code });
}
