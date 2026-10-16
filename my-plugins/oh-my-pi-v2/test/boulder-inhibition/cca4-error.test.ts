import assert from "node:assert/strict";
import { test } from "node:test";
import { describeThrown } from "../../boulder-inhibition/describe-error.ts";

test("error descriptions contain non-string message conversion failures", () => {
	const error = new Error("before");
	Object.defineProperty(error, "message", {
		value: {
			toString(): never {
				throw new Error("conversion failed");
			},
		},
	});
	assert.equal(describeThrown(error), "undescribable error");
	assert.doesNotThrow(() => `${describeThrown(error)}`);
});
