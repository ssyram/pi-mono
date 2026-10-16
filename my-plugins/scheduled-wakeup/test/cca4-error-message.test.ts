import assert from "node:assert/strict";
import { test } from "node:test";
import { loopErrorMessage } from "../src/loop-error-message.js";

test("loop diagnostics contain non-string Error.message conversion failures", () => {
	const error = new Error("before");
	Object.defineProperty(error, "message", {
		value: {
			toString(): never {
				throw new Error("conversion failed");
			},
		},
	});
	assert.equal(loopErrorMessage(error), "undescribable loop error");
	assert.doesNotThrow(() => `Loop command failed: ${loopErrorMessage(error)}`);
});
