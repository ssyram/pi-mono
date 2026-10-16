import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { registerCustomCompaction } from "../hooks/custom-compaction.js";

type Hook = (
	event: SessionBeforeCompactEvent,
	context: ExtensionContext,
) => unknown;
const hostile = {
	toString(): never {
		throw new Error("description failed");
	},
};

for (const startupFailure of [false, true]) {
	test(`compaction contains diagnostic and status failures (startup=${startupFailure})`, async (t) => {
		t.mock.method(console, "error", () => {
			throw hostile;
		});
		let handler: Hook | undefined;
		registerCustomCompaction(
			{
				on(_name: string, callback: Hook) {
					handler = callback;
				},
			} as unknown as ExtensionAPI,
			() => {
				throw new Error("must not read tasks without a model");
			},
		);
		let clears = 0;
		const context = {
			model: undefined,
			ui: {
				setStatus(_key: string, value: unknown) {
					if (value === undefined) {
						clears++;
						throw hostile;
					}
					if (startupFailure) throw hostile;
				},
			},
		} as unknown as ExtensionContext;
		assert.ok(handler);
		const callback = handler;
		await assert.doesNotReject(async () => {
			assert.equal(
				await callback({} as SessionBeforeCompactEvent, context),
				undefined,
			);
		});
		assert.equal(clears, 1);
	});
}
