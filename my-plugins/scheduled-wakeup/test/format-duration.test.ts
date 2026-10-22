import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "../src/format-duration.js";

test("round values stay single-unit", () => {
	assert.equal(formatDuration(10_000), "10s");
	assert.equal(formatDuration(60_000), "1m");
	assert.equal(formatDuration(3_600_000), "1h");
});

test("non-zero segments are concatenated", () => {
	assert.equal(formatDuration(72_000), "1m12s");
	assert.equal(formatDuration(5_400_000), "1h30m");
	assert.equal(formatDuration(86_400_000 + 3_600_000 + 60_000 + 5_000), "1d1h1m5s");
});

test("years and months use fixed approximations", () => {
	assert.equal(formatDuration(45 * 86_400_000), "1M15d");
	assert.equal(formatDuration(400 * 86_400_000), "1y1M5d");
});

test("sub-second values ceil and zero collapses to 0s", () => {
	assert.equal(formatDuration(1), "1s");
	assert.equal(formatDuration(71_001), "1m12s");
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(-5_000), "0s");
});
