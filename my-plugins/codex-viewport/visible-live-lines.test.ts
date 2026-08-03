import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleLiveLines } from "./visible-live-lines.js";

describe("visibleLiveLines", () => {
	it("keeps only the live tail that fits above trailing UI", () => {
		assert.deepEqual(visibleLiveLines(["1", "2", "3", "4", "5"], 5, 2), ["3", "4", "5"]);
	});

	it("returns the full live region when it fits", () => {
		assert.deepEqual(visibleLiveLines(["1", "2"], 5, 2), ["1", "2"]);
	});

	it("hides live rows when trailing UI fills the terminal", () => {
		assert.deepEqual(visibleLiveLines(["1", "2"], 2, 2), []);
	});
});
