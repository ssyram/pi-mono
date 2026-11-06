import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExecutionTarget } from "../src/v2/model.js";
import type { RunCatalog } from "../src/v2/run-catalog.js";
import type { RunView } from "../src/v2/run-catalog-state.js";
import type { RunEvent, RunWatcher, WatchedRun } from "../src/run-watch/run-watcher.js";
import { createTaskDispatcher } from "../src/task-dispatcher.js";


function view(
	taskId: string,
	state: RunView["state"],
	overrides: Partial<RunView> = {},
): RunView {
	return {
		taskId,
		runId: `${taskId}-run`,
		dir: `/tmp/runs/${taskId}/${taskId}-run`,
		startedAt: 1,
		record: {
			version: 1,
			taskId,
			scope: "session",
			payload: { prompt: "p" },
			ownerSessionId: "dispatcher-session",
			startedAt: 1,
		},
		status:
			state === "running"
				? { pid: 123, currentIndex: 0, success: 0, completed: 0, total: 2, updatedAt: 1 }
				: undefined,
		outcome:
			state === "pendingDelivery"
				? {
						cancelled: false,
						results: [],
						successCount: 1,
						shouldWake: false,
						completedAt: 2,
						content: "done",
					}
				: undefined,
		state,
		...overrides,
	};
}

function toWatched(v: RunView): WatchedRun {
	return {
		taskId: v.taskId,
		runId: v.runId,
		dir: v.dir,
		startedAt: v.startedAt,
		state: v.state === "running" || v.state === "pendingDelivery" ? v.state : "running",
		status: v.status,
		outcome: v.outcome,
	};
}

function fixture(views: RunView[]) {
	const messages: {
		customType: string;
		content: unknown;
		options?: { triggerTurn?: boolean };
	}[] = [];
	const handlers = new Map<string, (event: unknown) => unknown>();
	const started: ExecutionTarget[] = [];
	const cancelled: string[] = [];
	let idle = true;
	const watchedDirs = new Set<string>();
	const queue: RunEvent[] = [];
	const emitView = (v: RunView): void => {
		if (!watchedDirs.has(v.dir)) return;
		if (v.state !== "running" && v.state !== "pendingDelivery" && v.state !== "lost")
			return;
		queue.push({ type: "state", run: toWatched(v) });
	};
	const watcher: RunWatcher = {
		watch(seed) {
			watchedDirs.add(seed.dir);
			const v = views.find((entry) => entry.dir === seed.dir);
			if (v !== undefined) emitView(v);
		},
		unwatch(dir) {
			watchedDirs.delete(dir);
		},
		poll() {
			return queue.splice(0, queue.length);
		},
		snapshot() {
			return views
				.filter(
					(entry) =>
						watchedDirs.has(entry.dir) &&
						(entry.state === "running" || entry.state === "pendingDelivery"),
				)
				.map(toWatched);
		},
		dispose() {},
	};
	const catalog: RunCatalog = {
		startRun(target) {
			started.push(target);
			const pushed = view(target.id, "running");
			pushed.record = {
				...pushed.record,
				payload:
					target.scriptTask === undefined
						? { prompt: target.prompt }
						: { scriptTask: target.scriptTask },
			};
			views.push(pushed);
			watcher.watch({ dir: pushed.dir, taskId: pushed.taskId, runId: pushed.runId, startedAt: pushed.startedAt, sessionId: "dispatcher-session" });
			return pushed;
		},
		async bootScan() {
			return { views, foreignTaskIds: [], deleted: 0 };
		},
		async gc() {
			return 0;
		},
		repairLost() {
			return false;
		},
		markDelivered(dir) {
			const found = views.find((item) => item.dir === dir);
			if (found !== undefined) found.state = "done";
		},
		markCancelled(dir) {
			const found = views.find((item) => item.dir === dir);
			if (found !== undefined) found.state = "cancelled";
		},
		async cancelRunning(target) {
			cancelled.push(target.taskId);
			const found = views.find(
				(item) => item.taskId === target.taskId && item.state === "running",
			);
			if (found !== undefined) found.state = "cancelled";
			return "cancelled";
		},
	};
	const pi = {
		sendMessage: (
			message: { customType: string; content: unknown },
			options?: { triggerTurn?: boolean },
		) => messages.push({ ...message, ...(options ? { options } : {}) }),
		sendUserMessage: () => assert.fail("must use custom messages"),
		on: (name: string, handler: (event: unknown) => unknown) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		isIdle: () => idle,
		hasPendingMessages: () => false,
		sessionManager: { getSessionId: () => "dispatcher-session" },
	} as unknown as ExtensionContext;
	return {
		pi,
		ctx,
		messages,
		handlers,
		started,
		cancelled,
		catalog,
		views,
		watcher,
		watchedDirs,
		emitView,
		adopt(v: RunView) {
			views.push(v);
			watcher.watch({ dir: v.dir, taskId: v.taskId, runId: v.runId, startedAt: v.startedAt, sessionId: "dispatcher-session" });
		},
		setIdle(value: boolean) {
			idle = value;
		},
	};
}

function scriptTarget(id: string): ExecutionTarget {
	return {
		id,
		scope: "session",
		scriptTask: {
			wakeUp: { kind: "always", prompt: "check" },
			scripts: [
				{ cwd: "/w", path: "/w/a", params: [], timeoutSeconds: 1 },
				{ cwd: "/w", path: "/w/b", params: [], timeoutSeconds: 1 },
			],
		},
	};
}

test("dispatch starts a run, refresh adopts it, and same-id overlap is refused", async () => {
	const setup = fixture([]);
	const events: string[] = [];
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => events.push("change"),
		onSettled: () => events.push("settled"),
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	dispatcher.dispatch(scriptTarget("session:batch"));
	assert.equal(setup.started.length, 1);
	await dispatcher.refresh();
	assert.equal(dispatcher.list().length, 1);
	assert.deepEqual(
		[dispatcher.list()[0]?.success, dispatcher.list()[0]?.total],
		[0, 2],
	);
	assert.equal(dispatcher.list()[0]?.current?.path, "/w/a");
	assert.ok(events.includes("settled"));
	assert.throws(
		() => dispatcher.dispatch({ id: "session:batch", scope: "session", prompt: "dup" }),
		/already running/,
	);
	dispatcher.dispose();
});

test("prompt dispatch delivers immediately while idle and holds while busy", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	dispatcher.dispatch({ id: "session:prompt", scope: "session", prompt: "hello" });
	assert.equal(setup.messages.length, 1);
	assert.equal(setup.messages[0]?.options?.triggerTurn, true);
	assert.match(String(setup.messages[0]?.content), /hello/);

	setup.setIdle(false);
	dispatcher.dispatch({ id: "session:quiet", scope: "session", prompt: "later" });
	assert.equal(setup.messages.length, 1);
	assert.equal(
		dispatcher.deliveryStatus().get("session:quiet")?.wakeUps,
		1,
	);
	const settled = setup.handlers.get("agent_settled");
	assert.ok(settled);
	setup.setIdle(true);
	settled({ type: "agent_settled", aborted: false });
	assert.equal(setup.messages.length, 2);
	assert.equal(dispatcher.deliveryStatus().size, 0);
	dispatcher.dispose();
});

test("busy wake delivery joins the boundary continuation", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	setup.setIdle(false);
	dispatcher.dispatch({ id: "session:alert", scope: "session", prompt: "act" });
	const beforeSettle = setup.handlers.get("agent_before_settle");
	assert.ok(beforeSettle);
	const result = beforeSettle({ type: "agent_before_settle", outcome: "completed" }) as
		| { entries: unknown[]; continue?: boolean }
		| undefined;
	assert.ok(result);
	assert.equal(result.continue, true);
	assert.equal(result.entries.length, 1);
	assert.equal(setup.messages.length, 0);
	assert.equal(dispatcher.deliveryStatus().size, 0);
	dispatcher.dispose();
});

test("aborted boundary defers delivery to settle", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	setup.setIdle(false);
	dispatcher.dispatch({ id: "session:late", scope: "session", prompt: "x" });
	const beforeSettle = setup.handlers.get("agent_before_settle");
	assert.ok(beforeSettle);
	assert.equal(
		beforeSettle({ type: "agent_before_settle", outcome: "aborted" }),
		undefined,
	);
	assert.equal(dispatcher.deliveryStatus().get("session:late")?.wakeUps, 1);
	const settled = setup.handlers.get("agent_settled");
	assert.ok(settled);
	setup.setIdle(true);
	settled({ type: "agent_settled", aborted: true });
	assert.equal(setup.messages.length, 1);
	dispatcher.dispose();
});

test("finished runs from the catalog are delivered once when idle", async () => {
	const setup = fixture([view("session:done", "pendingDelivery")]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	assert.equal(setup.messages.length, 1);
	assert.equal(setup.messages[0]?.options?.triggerTurn, false);
	await dispatcher.refresh();
	assert.equal(setup.messages.length, 1);
	dispatcher.dispose();
});

test("terminateTaskRuns retracts pending deliveries and kills running batches", async () => {
	const pending = view("session:mixed", "pendingDelivery");
	pending.dir = "/tmp/runs/session:mixed/pending-run";
	const setup = fixture([view("session:mixed", "running"), pending]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	setup.setIdle(false);
	await dispatcher.refresh();
	const termination = await dispatcher.terminateTaskRuns("session:mixed");
	assert.deepEqual(termination, { killed: 1, retracted: 1 });
	assert.deepEqual(setup.cancelled, ["session:mixed"]);
	assert.equal(setup.messages.length, 0);
	dispatcher.dispose();
});

test("dispose unsubscribes without killing anything", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	setup.setIdle(false);
	dispatcher.dispatch({ id: "session:held", scope: "session", prompt: "x" });
	dispatcher.dispose();
	assert.equal(setup.handlers.has("agent_settled"), false);
	assert.equal(setup.cancelled.length, 0);
	assert.throws(
		() => dispatcher.dispatch({ id: "late", scope: "session", prompt: "x" }),
		/inactive/,
	);
});

test("E27: same-stack double dispatch is refused before any refresh", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	dispatcher.dispatch(scriptTarget("session:race"));
	assert.throws(
		() => dispatcher.dispatch(scriptTarget("session:race")),
		/already running/,
	);
	dispatcher.dispose();
});

test("E28: an empty-scripts always-wake task delivers as a prompt without spawning", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	dispatcher.dispatch({
		id: "session:empty",
		scope: "session",
		scriptTask: { wakeUp: { kind: "always", prompt: "direct please" }, scripts: [] },
	});
	assert.equal(setup.started.length, 0);
	assert.equal(setup.messages.length, 1);
	assert.match(String(setup.messages[0]?.content), /direct please/);
	dispatcher.dispose();
});

test("E21a: a run that completes during stop is retracted, not delivered", async () => {
	const setup = fixture([]);
	const running = view("session:during", "running");
	const pending = view("session:during", "pendingDelivery");
	pending.dir = "/tmp/runs/session:during/pending-run";
	setup.catalog.cancelRunning = async () => {
		// simulate the wrapper finishing instead of honouring the stop
		running.state = "pendingDelivery";
		running.outcome = pending.outcome;
		setup.emitView(running);
		return "already-finished" as const;
	};
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	setup.adopt(running);
	setup.setIdle(false);
	await dispatcher.refresh();
	const termination = await dispatcher.terminateTaskRuns("session:during");
	assert.deepEqual(termination, { killed: 1, retracted: 1 });
	assert.equal(setup.messages.length, 0);
	void pending;
	dispatcher.dispose();
});


test("a wedged run (status stale past its timeout budget) is killed and retried, a fresh one just refuses", async () => {
	const makeView = (pid: number, updatedAt: number, dir: string): RunView => {
		const v = view("session:wedge", "running", { dir });
		v.status = { pid, currentIndex: 0, success: 0, completed: 0, total: 1, updatedAt };
		v.record.payload = {
			scriptTask: {
				wakeUp: { kind: "never" },
				scripts: [{ cwd: "/w", path: "/w/s", params: [], timeoutSeconds: 1800 }],
			},
		} as never;
		return v;
	};
	// fresh run: refusal without unstick
	{
		const fresh = makeView(222, Date.now(), "/tmp/runs/wedge/fresh");
		const setup = fixture([fresh]);
		const cancelled: string[] = [];
		setup.catalog.cancelRunning = async (target) => {
			cancelled.push(target.dir);
			target.state = "cancelled";
			return "cancelled" as const;
		};
		const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
			onChange: () => undefined,
			onSettled: () => undefined,
			catalog: setup.catalog,
			watcher: setup.watcher,
		});
		await dispatcher.refresh();
		assert.throws(() => dispatcher.dispatch(scriptTarget("session:wedge")), /already running/);
		assert.deepEqual(cancelled, [], "fresh run must not be killed");
		dispatcher.dispose();
	}
	// wedged run: refusal triggers unstick so the next retry proceeds
	{
		const stale = makeView(111, Date.now() - (1800 * 1000 + 130_000), "/tmp/runs/wedge/stale");
		const setup = fixture([stale]);
		const cancelled: string[] = [];
		setup.catalog.cancelRunning = async (target) => {
			cancelled.push(target.dir);
			target.state = "cancelled";
			return "cancelled" as const;
		};
		const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
			onChange: () => undefined,
			onSettled: () => undefined,
			catalog: setup.catalog,
			watcher: setup.watcher,
		});
		await dispatcher.refresh();
		assert.throws(() => dispatcher.dispatch(scriptTarget("session:wedge")), /already running/);
		assert.deepEqual(cancelled, [stale.dir], "wedged run must be terminated");
		for (let i = 0; i < 50 && cancelled.length === 1; i++) await new Promise((r) => setTimeout(r, 20));
		dispatcher.dispose();
	}
});

test("starting clears after the run completes, so the next cycle dispatches again", async () => {
	const setup = fixture([]);
	const dispatcher = createTaskDispatcher(setup.pi, setup.ctx, {
		onChange: () => undefined,
		onSettled: () => undefined,
		catalog: setup.catalog,
		watcher: setup.watcher,
	});
	await dispatcher.refresh();
	dispatcher.dispatch(scriptTarget("session:cycle"));
	assert.throws(
		() => dispatcher.dispatch(scriptTarget("session:cycle")),
		/already running/,
	);
	// run completes and a later scan observes it terminal -> starting must clear
	const spawned = setup.views.find((view) => view.taskId === "session:cycle");
	assert.ok(spawned);
	spawned.state = "done";
	await dispatcher.refresh();
	dispatcher.dispatch(scriptTarget("session:cycle"));
	assert.equal(setup.started.length, 2, "second cycle must dispatch");
	dispatcher.dispose();
});
