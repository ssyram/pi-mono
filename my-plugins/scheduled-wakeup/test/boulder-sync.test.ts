import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { registerBoulderInhibitionAdapter } from "../../oh-my-pi-v2/hooks/boulder-inhibition-adapter.js";
import { createBoulderSync } from "../src/v2/boulder-sync.js";
import type { LoopV2Core } from "../src/v2/loop-core.js";

interface Harness {
	pi: ExtensionAPI;
	context: ExtensionContext;
	entries: Array<{ type: string; customType?: string; data?: unknown }>;
	core: LoopV2Core;
}

function createHarness(state: {
	tasks: Array<{
		inhibitBoulder?: boolean;
		status: "active" | "completed" | "expired";
	}>;
}): Harness {
	const entries: Array<{ type: string; customType?: string; data?: unknown }> =
		[];
	const handlers = new Map<
		string,
		Array<(event: unknown, context: ExtensionContext) => unknown>
	>();
	const sessionManager = {
		getSessionFile: () => "sync-test",
		getSessionId: () => "sync-test",
		getBranch: () => [...entries],
	};
	const context = {
		mode: "print",
		hasUI: false,
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager,
		ui: { notify: () => undefined },
	} as unknown as ExtensionContext;
	const pi = {
		on: (
			event: string,
			handler: (event: unknown, context: ExtensionContext) => unknown,
		) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		events: createEventBus(),
		appendEntry: (customType: string, data: unknown) => {
			entries.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	const core = {
		snapshotSessionState: () => ({
			version: 1 as const,
			tasks: state.tasks.map((task, index) => ({
				definition: {
					id: `session:test-${index}`,
					scope: "session" as const,
					prompt: "test",
					schedule: { kind: "interval" as const, intervalMs: 60_000 },
					createdAt: 1,
					...(task.inhibitBoulder !== undefined
						? { inhibitBoulder: task.inhibitBoulder }
						: {}),
				},
				progress:
					task.status === "active"
						? { status: "active" as const, nextRunAt: 2, runCount: 0 }
						: task.status === "completed"
							? { status: "completed" as const, runCount: 1, lastRunAt: 2 }
							: { status: "expired" as const, runCount: 1, expiredAt: 3 },
			})),
			registrations: [],
		}),
		registrationInhibition: () => ({ kind: "missing" as const }),
	} as unknown as LoopV2Core;

	registerBoulderInhibitionAdapter(pi, () => undefined);
	for (const handler of handlers.get("session_start") ?? [])
		handler({ reason: "new" }, context);
	return { pi, context, entries, core };
}

describe("boulder-sync bridge", () => {
	const lastSignal = (
		entries: Array<{ type: string; customType?: string; data?: unknown }>,
	) =>
		[...entries]
			.reverse()
			.find((entry) => entry.customType === "OMPv2InhibitBoulder");

	it("writes loop=true when an active special task exists and false when all are gone", () => {
		const state: Parameters<typeof createHarness>[0] = {
			tasks: [{ inhibitBoulder: true, status: "active" }],
		};
		const harness = createHarness(state);
		const bridge = createBoulderSync(harness.pi, harness.context, harness.core);
		bridge.sync();
		assert.deepEqual(lastSignal(harness.entries), {
			type: "custom",
			customType: "OMPv2InhibitBoulder",
			data: { type: "loop", value: true },
		});

		const completed = state.tasks[0];
		assert.ok(completed);
		completed.status = "completed";
		bridge.sync();
		assert.deepEqual(lastSignal(harness.entries), {
			type: "custom",
			customType: "OMPv2InhibitBoulder",
			data: { type: "loop", value: false },
		});
	});

	it("writes loop=false on the first sync when no special task exists", () => {
		const harness = createHarness({ tasks: [] });
		const bridge = createBoulderSync(harness.pi, harness.context, harness.core);
		bridge.sync();
		assert.deepEqual(lastSignal(harness.entries), {
			type: "custom",
			customType: "OMPv2InhibitBoulder",
			data: { type: "loop", value: false },
		});
	});

	it("does not re-write when the aggregate has not changed", () => {
		const state = {
			tasks: [{ inhibitBoulder: true, status: "active" as const }],
		};
		const harness = createHarness(state);
		const bridge = createBoulderSync(harness.pi, harness.context, harness.core);
		bridge.sync();
		const countAfterFirst = harness.entries.length;
		bridge.sync();
		bridge.sync();
		assert.equal(harness.entries.length, countAfterFirst);
	});

	it("does not throw when the service has no provider", () => {
		const handlers = new Map<
			string,
			Array<(event: unknown, context: ExtensionContext) => unknown>
		>();
		const pi = {
			on: (
				event: string,
				handler: (event: unknown, context: ExtensionContext) => unknown,
			) => {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
			events: { emit: () => undefined, on: () => () => undefined },
			appendEntry: () => undefined,
		} as unknown as ExtensionAPI;
		const context = {
			mode: "print",
			hasUI: false,
			sessionManager: {},
		} as unknown as ExtensionContext;
		const core = {
			snapshotSessionState: () => {
				throw new Error("state busy");
			},
		} as unknown as LoopV2Core;
		const bridge = createBoulderSync(pi, context, core);
		assert.doesNotThrow(() => bridge.sync());
	});
});
