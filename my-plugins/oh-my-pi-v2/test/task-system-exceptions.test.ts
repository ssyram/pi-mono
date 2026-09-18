import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { taskAdmission } from "../tools/task-system/admission.js";
import { createTaskSession } from "../tools/task-system/session.js";
import { createTaskToolDefinition } from "../tools/task-system/tool-definition.js";
import { entry, state, task, text } from "./task-system-fixtures.js";

const poison = Object.defineProperty(
	{
		toString() {
			throw new Error("must not stringify");
		},
	},
	"message",
	{
		get() {
			throw new Error("must not read message");
		},
	},
);

describe("task exception containment", () => {
	it("retains records and ID floor on partial native append and never retries", () => {
		const session = createTaskSession(state(task(1)));
		const nativeEntries: SessionEntry[] = [];
		let calls = 0;
		const result = session.execute(
			{ action: "add", text: "uncertain" },
			(snapshot) => {
				calls++;
				nativeEntries.push(entry(snapshot));
				snapshot.tasks[0].text = "persistence argument mutation";
				throw poison;
			},
		);
		assert.equal(calls, 1);
		assert.equal(result.changed, false);
		assert.equal(result.result.details.partial, false);
		assert.deepEqual(result.state, { ...state(task(1)), nextId: 3 });
		assert.match(text(result), /Native log\/disk outcome is uncertain/);
		assert.match(text(result), /no rollback is claimed/);
		result.state.tasks[0].text = "result mutation";
		assert.equal(session.snapshot().tasks[0].text, "task 1");
		assert.equal(nativeEntries.length, 1);
		const next = session.execute({ action: "add", text: "next" }, () => {});
		assert.equal(next.state.tasks[1].id, 3);
	});
	it("clear returns an error operation on failure and a normal operation on success", () => {
		const session = createTaskSession(state(task(4)));
		const failed = session.clear(() => {
			throw poison;
		});
		assert.equal(failed.changed, false);
		assert.deepEqual(failed.state, state(task(4)));
		assert.match(text(failed), /persistence failed/);
		const cleared = session.clear(() => {});
		assert.equal(cleared.changed, true);
		assert.deepEqual(cleared.state, { tasks: [], nextId: 5 });
		assert.deepEqual(session.snapshot(), cleared.state);
	});
	it("contains model and human transform faults before any persistence", (t) => {
		const initial = state(task(1));
		const session = createTaskSession(initial);
		t.mock.method(Date, "now", () => {
			throw poison;
		});
		const persist = () => assert.fail("must not persist");
		for (const result of [
			session.execute({ action: "add", text: "new" }, persist),
			session.executeHuman("modify 1 --text changed --status done", persist),
		]) {
			assert.equal(result.changed, false);
			assert.deepEqual(result.state, initial);
			assert.match(text(result), /before persistence/);
		}
		assert.deepEqual(session.snapshot(), initial);
	});
	it("does not use rich row formatting again while reporting its failure", (t) => {
		const session = createTaskSession(
			state({ ...task(1, "expired"), expireReason: "reason" }),
		);
		const trim = String.prototype.trim;
		let faults = 0;
		t.mock.method(String.prototype, "trim", function (this: string) {
			if (String(this) === "reason") {
				faults++;
				throw poison;
			}
			return trim.call(this);
		});
		const result = session.execute({ action: "list" }, () => assert.fail());
		assert.equal(faults, 1);
		assert.equal(result.changed, false);
		assert.match(text(result), /before persistence/);
		assert.deepEqual(result.result.details.rows, []);
		assert.equal(result.state.tasks[0].expireReason, "reason");
	});
	it("contains an exceptional unknown input and unsafe error stringification", () => {
		const input = Object.defineProperty({}, "action", {
			get() {
				throw poison;
			},
		});
		const session = createTaskSession();
		const result = session.execute(input, () => assert.fail());
		assert.equal(result.changed, false);
		assert.ok(result.result.details.error);
		assert.deepEqual(session.snapshot(), { tasks: [], nextId: 1 });
	});
	it("returns explicit restore outcomes, retaining state and reservations on failure", () => {
		const session = createTaskSession(state(task(4)));
		session.execute({ action: "add", text: "reserved" }, () => {
			throw poison;
		});
		const before = session.snapshot();
		const bad = [entry(state(task(99)))];
		Object.defineProperty(bad[0], "data", {
			get() {
				throw poison;
			},
		});
		const failed = session.restore([], bad);
		assert.equal(failed.ok, false);
		if (!failed.ok) assert.match(failed.error, /requested branch not restored/);
		assert.deepEqual(session.snapshot(), before);
		assert.deepEqual(session.restore([], []), { ok: true });
		assert.deepEqual(session.snapshot(), { tasks: [], nextId: 6 });
	});
	it("refuses admission on reader or classifier failure without another read", () => {
		let calls = 0;
		const fail = () => {
			calls++;
			throw poison;
		};
		assert.equal(taskAdmission("task", fail), undefined);
		assert.equal(calls, 0);
		const refusal = taskAdmission("read", fail);
		assert.equal(refusal?.block, true);
		assert.match(refusal?.reason ?? "", /could not be checked/);
		assert.equal(calls, 1);
		const broken = task(1, "in_progress");
		Object.defineProperty(broken, "blockedBy", {
			get() {
				throw poison;
			},
		});
		assert.equal(taskAdmission("write", () => [broken])?.block, true);
	});
	it("contains arbitrary run errors without claiming a prior commit was rolled back", async () => {
		const session = createTaskSession();
		let writes = 0;
		const definition = createTaskToolDefinition((input) => {
			session.execute(input, () => writes++);
			throw poison;
		});
		const result = await definition.execute(
			"id",
			{ action: "add", text: "committed" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		assert.equal(writes, 1);
		assert.equal(session.snapshot().tasks[0].text, "committed");
		assert.ok("stateUnavailable" in result.details);
		assert.match(result.details.error, /outcome are unavailable/);
		assert.equal("isError" in result, false);
		assert.doesNotMatch(
			result.content[0].type === "text" ? result.content[0].text : "",
			/no changes|rolled back/,
		);
	});
});
