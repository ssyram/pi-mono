import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDuration } from "../src/parse-duration.js";

const SECOND = 1_000;

describe("parseDuration", () => {
	it("parses supported units", () => {
		assert.equal(parseDuration("10s"), 10 * SECOND);
		assert.equal(parseDuration("5m"), 5 * 60 * SECOND);
		assert.equal(parseDuration("2h"), 2 * 60 * 60 * SECOND);
		assert.equal(parseDuration("1d"), 24 * 60 * 60 * SECOND);
	});

	it("rejects invalid values", () => {
		assert.equal(parseDuration("0s"), undefined);
		assert.equal(parseDuration("1w"), undefined);
		assert.equal(parseDuration("abc"), undefined);
		assert.equal(parseDuration("1m later"), undefined);
		assert.equal(parseDuration("999999999999999999d"), undefined);
	});
});
