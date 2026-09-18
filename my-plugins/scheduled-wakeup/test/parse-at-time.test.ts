import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAtTime } from "../src/parse-at-time.js";

describe("parseAtTime", () => {
	it("parses tomorrow clock expressions in local time", () => {
		const now = new Date(2026, 7, 4, 10, 0, 0, 0);
		const parsed = parseAtTime("12am tomorrow", now);
		assert.equal(parsed, new Date(2026, 7, 5, 0, 0, 0, 0).getTime());
	});

	it("parses clock expressions with UTC", () => {
		const now = new Date("2026-08-04T10:00:00Z");
		assert.equal(parseAtTime("00:00 tomorrow UTC", now), Date.parse("2026-08-05T00:00:00Z"));
	});

	it("parses clock expressions with numeric timezone offsets", () => {
		const now = new Date("2026-08-04T10:00:00Z");
		assert.equal(parseAtTime("09:30 tomorrow +08:00", now), Date.parse("2026-08-05T01:30:00Z"));
	});

	it("parses ISO timestamps with explicit timezone", () => {
		const now = new Date("2026-08-04T10:00:00Z");
		assert.equal(parseAtTime("2026-08-05T00:00:00Z", now), Date.parse("2026-08-05T00:00:00Z"));
	});

	it("rejects past or ambiguous values", () => {
		const now = new Date("2026-08-04T10:00:00Z");
		assert.equal(parseAtTime("2026-08-04T09:00:00Z", now), undefined);
		assert.equal(parseAtTime("12xm tomorrow", now), undefined);
		assert.equal(parseAtTime("12am tomorrow PST", now), undefined);
	});
});
