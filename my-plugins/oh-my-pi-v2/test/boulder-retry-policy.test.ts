import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	formatBoulderDelay,
	getBoulderAttemptDelayMs,
	getBoulderAttemptLimit,
	getBoulderContextMode,
} from "../hooks/boulder-retry-policy.js";

const NORMAL_DELAYS = [10_000, 10_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000, 1_280_000];

describe("Boulder retry policy", () => {
	it("uses three print attempts and ten attempts in every other mode", () => {
		assert.equal(getBoulderAttemptLimit("print"), 3);
		assert.equal(getBoulderAttemptLimit("tui"), 10);
		assert.equal(getBoulderAttemptLimit("rpc"), 10);
		assert.equal(getBoulderAttemptLimit("json"), 10);
	});

	it("produces the required delay sequence and one-hour cap", () => {
		assert.deepEqual(
			NORMAL_DELAYS.map((_delay, index) => getBoulderAttemptDelayMs(index + 1)),
			NORMAL_DELAYS,
		);
		assert.equal(getBoulderAttemptDelayMs(20), 3_600_000);
		assert.equal(getBoulderAttemptDelayMs(100), 3_600_000);
		assert.equal(formatBoulderDelay(160_000), "160s");
		assert.equal(formatBoulderDelay(3_600_000), "1h");
	});

	it("reads both checked-in context.mode and compatibility ui.mode", () => {
		assert.equal(getBoulderContextMode({ mode: "print", ui: {} } as unknown as ExtensionContext), "print");
		assert.equal(getBoulderContextMode({ ui: { mode: "print" } } as unknown as ExtensionContext), "print");
	});
});
