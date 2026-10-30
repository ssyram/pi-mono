import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createDeliveryCoordinator } from "../src/v2/delivery-coordinator.js";
import type { RunCatalog } from "../src/v2/run-catalog.js";
import type { RunView } from "../src/v2/run-catalog-state.js";

function pendingView(
	taskId: string,
	shouldWake: boolean,
	runDir: string | undefined,
): RunView {
	return {
		taskId,
		runId: `${taskId}-run`,
		dir: runDir ?? `/tmp/${taskId}`,
		startedAt: 1,
		record: {
			version: 1,
			taskId,
			scope: "session",
			payload: {
				scriptTask: {
					wakeUp: { kind: "always", prompt: "act" },
					scripts: [],
				},
			},
			ownerSessionId: "coordinator-session",
			startedAt: 1,
		},
		status: undefined,
		outcome: {
			cancelled: false,
			results: [],
			successCount: 1,
			shouldWake,
			completedAt: 5,
			content: "finished body",
		},
		state: "pendingDelivery",
	};
}

function fixture(options: { failSends?: number; idleSequence?: boolean[] } = {}) {
	const state = { idle: true };
	let failSends = options.failSends ?? 0;
	const idleSequence = [...(options.idleSequence ?? [])];
	const messages: { customType: string; content: unknown; options?: { triggerTurn?: boolean } }[] = [];
	const handlers = new Map<string, (event: unknown) => unknown>();
	const markers: { dir: string; how?: string; stage?: string }[] = [];
	const catalog = {
		markDelivered(dir: string, how: "idle-send" | "boundary-entries") {
			markers.push({ dir, how });
		},
		markCancelled(dir: string, stage: "running" | "pendingDelivery") {
			markers.push({ dir, stage });
		},
	} as unknown as RunCatalog;
	const pi = {
		sendMessage: (
			message: { customType: string; content: unknown },
			options?: { triggerTurn?: boolean },
		) => {
			if (failSends > 0) {
				failSends -= 1;
				throw new Error("send failed");
			}
			messages.push({ ...message, ...(options ? { options } : {}) });
		},
		sendUserMessage: () => assert.fail("must use custom messages"),
		on: (name: string, handler: (event: unknown) => unknown) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
	} as unknown as ExtensionAPI;
	let now = 1000;
	const ctx = {
		isIdle: () =>
			idleSequence.length > 0 ? (idleSequence.shift() as boolean) : state.idle,
		hasPendingMessages: () => false,
	} as unknown as ExtensionContext;
	const coordinator = createDeliveryCoordinator(pi, ctx, catalog, () => now);
	return {
		coordinator,
		messages,
		handlers,
		markers,
		setIdle(value: boolean) {
			state.idle = value;
		},
		advance(value: number) {
			now = value;
		},
	};
}

test("idle wake deliveries send immediately with triggerTurn and mark delivered", () => {
	const setup = fixture();
	setup.coordinator.enqueueRun(pendingView("session:wake", true, undefined));
	assert.equal(setup.messages.length, 1);
	assert.equal(setup.messages[0]?.options?.triggerTurn, true);
	assert.match(String(setup.messages[0]?.content), /finished body/);
	assert.equal(setup.coordinator.pending().length, 0);
});

test("idle no-wake deliveries send without starting a turn", () => {
	const setup = fixture();
	setup.coordinator.enqueueRun(pendingView("session:quiet", false, undefined));
	assert.equal(setup.messages.length, 1);
	assert.equal(setup.messages[0]?.options?.triggerTurn, false);
});

test("busy pending joins the boundary continuation only when waking", () => {
	const setup = fixture();
	setup.setIdle(false);
	setup.coordinator.enqueueRun(pendingView("session:busy", true, undefined));
	setup.coordinator.enqueueRun(pendingView("session:busy2", false, undefined));
	const before = setup.handlers.get("agent_before_settle");
	assert.ok(before);
	const result = before({ type: "agent_before_settle", outcome: "completed" }) as {
		entries: { customType: string }[];
		continue?: boolean;
	};
	assert.equal(result.entries.length, 2);
	assert.equal(result.continue, true);
	assert.equal(setup.messages.length, 0);
	assert.equal(setup.coordinator.pending().length, 0);
});

test("busy no-wake-only boundaries append entries without continuing", () => {
	const setup = fixture();
	setup.setIdle(false);
	setup.coordinator.enqueueRun(pendingView("session:note", false, undefined));
	const before = setup.handlers.get("agent_before_settle");
	assert.ok(before);
	const result = before({ type: "agent_before_settle", outcome: "completed" }) as {
		entries: unknown[];
		continue?: boolean;
	};
	assert.equal(result.entries.length, 1);
	assert.equal(result.continue, undefined);
});

test("aborted boundaries defer to settle, which flushes idle", () => {
	const setup = fixture();
	setup.setIdle(false);
	setup.coordinator.enqueueRun(pendingView("session:late", true, undefined));
	const before = setup.handlers.get("agent_before_settle");
	assert.ok(before);
	assert.equal(before({ type: "agent_before_settle", outcome: "aborted" }), undefined);
	assert.equal(setup.coordinator.pending().length, 1);
	setup.setIdle(true);
	const settled = setup.handlers.get("agent_settled");
	assert.ok(settled);
	settled({ type: "agent_settled", aborted: true });
	assert.equal(setup.messages.length, 1);
	assert.equal(setup.messages[0]?.options?.triggerTurn, true);
});

test("cancelPending retracts disk-backed runs and suppresses delivery", () => {
	const setup = fixture();
	setup.setIdle(false);
	const dir = mkdtempSync(join(tmpdir(), "loop-retract-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:retract", true, dir));
		assert.equal(setup.coordinator.cancelPending("session:retract"), 1);
		assert.deepEqual(setup.markers, [
			{ dir, stage: "pendingDelivery" },
		]);
		const settled = setup.handlers.get("agent_settled");
		assert.ok(settled);
		settled({ type: "agent_settled", aborted: false });
		assert.equal(setup.messages.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runs retracted by another session are dropped at pump time", () => {
	const setup = fixture();
	setup.setIdle(false);
	const dir = mkdtempSync(join(tmpdir(), "loop-cross-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:cross", true, dir));
		writeFileSync(
			join(dir, "cancelled.json"),
			JSON.stringify({ sessionId: "other", at: 1, stage: "pendingDelivery" }),
		);
		const settled = setup.handlers.get("agent_settled");
		assert.ok(settled);
		settled({ type: "agent_settled", aborted: false });
		assert.equal(setup.messages.length, 0);
		assert.equal(setup.coordinator.pending().length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("delivered markers from another session stop a re-delivery attempt", () => {
	const setup = fixture();
	setup.setIdle(false);
	const dir = mkdtempSync(join(tmpdir(), "loop-delivered-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:sent", true, dir));
		writeFileSync(
			join(dir, "delivered.json"),
			JSON.stringify({ sessionId: "other", deliveredAt: 1, how: "idle-send" }),
		);
		const settled = setup.handlers.get("agent_settled");
		assert.ok(settled);
		settled({ type: "agent_settled", aborted: false });
		assert.equal(setup.messages.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("deliveryStatus counts pending wake and no-wake per task", () => {
	const setup = fixture();
	setup.setIdle(false);
	const wake = pendingView("session:count", true, "/tmp/count-wake");
	const noWake = pendingView("session:count", false, "/tmp/count-quiet");
	setup.coordinator.enqueueRun(wake);
	setup.coordinator.enqueueRun(noWake);
	assert.deepEqual(setup.coordinator.deliveryStatus().get("session:count"), {
		wakeUps: 1,
		noWakes: 1,
	});
});

test("includeTimestamp payloads stamp completed-at and sent-at at send time", () => {
	const setup = fixture();
	const view = pendingView("session:stamp", true, undefined);
	view.record.payload.includeTimestamp = true;
	setup.coordinator.enqueueRun(view);
	assert.match(String(setup.messages[0]?.content), /completed-at: /);
	assert.match(String(setup.messages[0]?.content), /sent-at: /);
});

test("E19: boundary deliveries are marked delivered only after settle", () => {
	const setup = fixture();
	setup.setIdle(false);
	const dir = mkdtempSync(join(tmpdir(), "loop-e19-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:b", true, dir));
		const before = setup.handlers.get("agent_before_settle");
		assert.ok(before);
		const result = before({ type: "agent_before_settle", outcome: "completed" }) as {
			entries: unknown[];
		};
		assert.equal(result.entries.length, 1);
		assert.deepEqual(setup.markers.filter((m) => m.how !== undefined), []);
		setup.setIdle(true);
		const settled = setup.handlers.get("agent_settled");
		assert.ok(settled);
		settled({ type: "agent_settled", aborted: false });
		assert.deepEqual(
			setup.markers.filter((m) => m.how === "boundary-entries"),
			[{ dir, how: "boundary-entries" }],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("E20: cancelPending skips already-delivered runs and reports zero", () => {
	const setup = fixture();
	setup.setIdle(false);
	const dir = mkdtempSync(join(tmpdir(), "loop-e20-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:d", true, dir));
		writeFileSync(
			join(dir, "delivered.json"),
			JSON.stringify({ sessionId: "other", deliveredAt: 1, how: "idle-send" }),
		);
		assert.equal(setup.coordinator.cancelPending("session:d"), 0);
		assert.equal(existsSync(join(dir, "cancelled.json")), false);
		assert.equal(setup.coordinator.pending().length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("E32: a failed send keeps the item pending for the next pump", () => {
	const setup = fixture({ failSends: 1 });
	const dir = mkdtempSync(join(tmpdir(), "loop-e32-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:r", true, dir));
		assert.equal(setup.messages.length, 0);
		assert.equal(setup.coordinator.pending().length, 1);
		setup.coordinator.pump();
		assert.equal(setup.messages.length, 1);
		assert.equal(setup.coordinator.pending().length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("E16: batch flush stops when the agent stops being idle mid-batch", () => {
	const setup = fixture({ idleSequence: [true, false, false] });
	setup.setIdle(false);
	const dir1 = mkdtempSync(join(tmpdir(), "loop-e16a-"));
	const dir2 = mkdtempSync(join(tmpdir(), "loop-e16b-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:a", true, dir1));
		setup.coordinator.enqueueRun(pendingView("session:b", true, dir2));
		// idle sequence true, false, false: prune pass consumes one true, then the
		// deliver loop's per-item check sees false and stops after zero sends.
		setup.coordinator.pump();
		assert.equal(setup.messages.length, 0);
		assert.equal(setup.coordinator.pending().length, 2);
	} finally {
		rmSync(dir1, { recursive: true, force: true });
		rmSync(dir2, { recursive: true, force: true });
	}
});

test("E19-fix: boundary markers land via timer without agent_settled", async () => {
	const setup = fixture();
	setup.setIdle(false);
	const dir = mkdtempSync(join(tmpdir(), "loop-e19fix-"));
	try {
		setup.coordinator.enqueueRun(pendingView("session:t", true, dir));
		const before = setup.handlers.get("agent_before_settle");
		assert.ok(before);
		before({ type: "agent_before_settle", outcome: "completed" });
		assert.deepEqual(
			setup.markers.filter((m) => m.how === "boundary-entries"),
			[],
			"no immediate marker",
		);
		await new Promise((resolve) => setTimeout(resolve, 2300));
		assert.deepEqual(
			setup.markers.filter((m) => m.how === "boundary-entries"),
			[{ dir, how: "boundary-entries" }],
			"timer writes the marker without settled",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
