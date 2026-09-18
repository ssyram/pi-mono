import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAtTime } from "../src/parse-at-time.js";
import { parseLoopV2Command } from "../src/v2/parse-v2-command.js";

const NOW = 1_700_000_000_000;

describe("parseLoopV2Command", () => {
	it("parses session recurring and one-shot delay forms", () => {
		assert.deepEqual(parseLoopV2Command("add 5m check status", NOW), {
			kind: "add",
			schedule: { kind: "interval", intervalMs: 300_000 },
			prompt: "check status",
		});
		assert.deepEqual(parseLoopV2Command("add once 10s stretch", NOW), {
			kind: "add",
			schedule: { kind: "once", runAt: NOW + 10_000 },
			prompt: "stretch",
		});
	});

	it("consumes at expressions up to the -- separator", () => {
		const parsed = parseLoopV2Command("add at 09:30 tomorrow +08:00 -- check the deploy", NOW);
		assert.equal(parsed.kind, "add");
		if (parsed.kind !== "add") return;
		assert.deepEqual(parsed.schedule, { kind: "once", runAt: parseAtTime("09:30 tomorrow +08:00", new Date(NOW)) });
		assert.equal(parsed.prompt, "check the deploy");
	});

	it("parses define in all three schedule forms with scope aliases", () => {
		const recurring = parseLoopV2Command("define ws 1h patrol", NOW);
		assert.deepEqual(recurring, { kind: "define", scope: "workspace", schedule: { kind: "interval", intervalMs: 3_600_000 }, prompt: "patrol" });
		const once = parseLoopV2Command("define global once 2d wind down", NOW);
		assert.deepEqual(once, { kind: "define", scope: "global", schedule: { kind: "once", runAt: NOW + 172_800_000 }, prompt: "wind down" });
		const at = parseLoopV2Command("define workspace at 2099-01-01T00:00:00Z -- report", NOW);
		assert.equal(at.kind, "define");
		if (at.kind !== "define") return;
		assert.equal(at.scope, "workspace");
		assert.deepEqual(at.schedule, { kind: "once", runAt: Date.parse("2099-01-01T00:00:00Z") });
	});

	it("defaults available to both scopes and accepts an explicit one", () => {
		assert.deepEqual(parseLoopV2Command("available", NOW), { kind: "available", scopes: ["workspace", "global"] });
		assert.deepEqual(parseLoopV2Command("available ws", NOW), { kind: "available", scopes: ["workspace"] });
		assert.deepEqual(parseLoopV2Command("available global", NOW), { kind: "available", scopes: ["global"] });
		assert.equal(parseLoopV2Command("available bogus", NOW).kind, "error");
	});

	it("parses register, unregister, list, stop, and run", () => {
		assert.deepEqual(parseLoopV2Command("register ws workspace:abc", NOW), { kind: "register", scope: "workspace", definitionId: "workspace:abc" });
		assert.deepEqual(parseLoopV2Command("unregister registration:workspace:abc", NOW), { kind: "unregister", registrationId: "registration:workspace:abc" });
		assert.deepEqual(parseLoopV2Command("list", NOW), { kind: "list" });
		assert.deepEqual(parseLoopV2Command("stop all", NOW), { kind: "stop", target: "all" });
		assert.deepEqual(parseLoopV2Command("stop session:abc", NOW), { kind: "stop", target: "session:abc" });
		assert.deepEqual(parseLoopV2Command("run session:abc", NOW), { kind: "run", id: "session:abc" });
	});

	it("derives delete scope from the id prefix and keeps --force user-only by parsing it", () => {
		assert.deepEqual(parseLoopV2Command("delete workspace:abc", NOW), { kind: "delete", scope: "workspace", definitionId: "workspace:abc", force: false });
		assert.deepEqual(parseLoopV2Command("delete --force global:abc", NOW), { kind: "delete", scope: "global", definitionId: "global:abc", force: true });
		assert.match(errorOf(parseLoopV2Command("delete abc", NOW)), /workspace:/);
		assert.match(errorOf(parseLoopV2Command("delete", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("delete --force", NOW)), /Usage/);
		assert.equal(parseLoopV2Command("list extra", NOW).kind, "error");
	});

	it("returns help for empty args and help, and errors on unknown commands", () => {
		assert.deepEqual(parseLoopV2Command("", NOW), { kind: "help" });
		assert.deepEqual(parseLoopV2Command("help", NOW), { kind: "help" });
		assert.match(errorOf(parseLoopV2Command("bogus x", NOW)), /Unknown command/);
	});

	it("reports invalid durations, overflow, missing prompts, and bad at expressions", () => {
		assert.match(errorOf(parseLoopV2Command("add 5x patrol", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("add 999999999999999d patrol", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("add 5m", NOW)), /at least one non-empty token/);
		assert.match(errorOf(parseLoopV2Command("add once 5m", NOW)), /at least one non-empty token/);
		assert.match(errorOf(parseLoopV2Command("add at 09:30 patrol", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("add at -- patrol", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("add at 2000-01-01T00:00:00Z -- late", NOW)), /Invalid or past time/);
		assert.match(errorOf(parseLoopV2Command("define ws", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("register workspace", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("unregister", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("stop", NOW)), /Usage/);
		assert.match(errorOf(parseLoopV2Command("run", NOW)), /Usage/);
	});
});

function errorOf(command: ReturnType<typeof parseLoopV2Command>): string {
	if (command.kind !== "error") throw new Error(`expected error, got ${command.kind}`);
	return command.message;
}
