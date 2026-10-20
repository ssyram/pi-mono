import { RuntimeError } from "../runtime/runtime-error.ts";
import type { ValidateFunction } from "ajv";

export interface StructuredCapture {
	readonly toolCallId: string;
	readonly value: Record<string, unknown>;
	readonly time: { readonly start: number; readonly end: number };
}
export interface FailedCapture {
	readonly toolCallId: string;
	readonly input: Record<string, unknown>;
	readonly error: string;
	readonly time: { readonly start: number; readonly end: number };
}
export interface CaptureOutcome {
	readonly kind: "captured" | "invalid";
	readonly content: string;
	readonly terminate: boolean;
	readonly failed: FailedCapture | undefined;
}

/** One judge turn's StructuredOutput ledger. Conflict material is kept, never overwritten. */
export class CaptureTurn {
	private captured: readonly StructuredCapture[] = [];
	private failures: readonly FailedCapture[] = [];
	private validate: ValidateFunction;

	constructor(validate: ValidateFunction) {
		this.validate = validate;
	}

	get captures(): readonly StructuredCapture[] { return this.captured; }

	get failedAttempts(): readonly FailedCapture[] { return this.failures; }

	reset(validate: ValidateFunction = this.validate): void {
		this.validate = validate;
		this.captured = [];
		this.failures = [];
	}

	capture(toolCallId: string, input: Record<string, unknown>): CaptureOutcome {
		if (!toolCallId) throw new RuntimeError("protocol-invalid");
		const start = Date.now();
		if (!this.validate(input)) {
			const failed: FailedCapture = { toolCallId, input, error: "structured output failed schema validation",
				time: { start, end: Date.now() } };
			this.failures = [...this.failures, failed];
			return { kind: "invalid", content: failed.error, terminate: false, failed };
		}
		this.captured = [...this.captured, { toolCallId, value: structuredClone(input), time: { start, end: Date.now() } }];
		return { kind: "captured", content: JSON.stringify(input), terminate: true, failed: undefined };
	}
}
