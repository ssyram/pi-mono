// Regression tests for ND-001 (manualSetState interactive guard) and
// ND-002 (parser unreachable-state rejection). Run with:
//
//   node --import tsx my-plugins/steering-flow/test/regressions.ts
//
// Exits non-zero on first failure. Keeps everything in stdlib + tsx so we
// don't introduce a new test framework into this plugin for two tests.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFlowConfig, buildFSM, ParseError } from "../parser.js";
import { ensureSessionDir, writeFsmStructure, writeState } from "../storage.js";
import { manualSetState } from "../manual-control.js";

let failed = false;

function ok(label: string) {
	console.log(`PASS ${label}`);
}
function fail(label: string, why: string) {
	failed = true;
	console.error(`FAIL ${label}: ${why}`);
}

// ---------- ND-002: parser must reject unreachable states ----------
{
	const cfg = {
		task_description: "nd-002 fixture",
		states: [
			{
				state_id: "$START",
				state_desc: "start",
				is_epsilon: false,
				actions: [
					{
						action_id: "go",
						action_desc: "go end",
						condition: { cmd: "node", args: ["../examples/scripts/always-true.mjs", "ok", "${$TAPE_FILE}"] },
						next_state_id: "$END",
					},
				],
			},
			{ state_id: "$END", state_desc: "end", is_epsilon: false, actions: [] },
			{
				state_id: "A",
				state_desc: "orphan A",
				is_epsilon: false,
				actions: [
					{
						action_id: "a_to_b",
						action_desc: "A to B",
						condition: { cmd: "node", args: ["../examples/scripts/always-true.mjs", "ok", "${$TAPE_FILE}"] },
						next_state_id: "B",
					},
				],
			},
			{
				state_id: "B",
				state_desc: "orphan B",
				is_epsilon: false,
				actions: [
					{
						action_id: "b_to_a",
						action_desc: "B to A",
						condition: { cmd: "node", args: ["../examples/scripts/always-true.mjs", "ok", "${$TAPE_FILE}"] },
						next_state_id: "A",
					},
				],
			},
		],
	};
	try {
		const parsed = parseFlowConfig(JSON.stringify(cfg), "fixture.json");
		buildFSM(parsed);
		fail("ND-002 unreachable cycle parser rejection", "buildFSM accepted unreachable A<->B cycle");
	} catch (err) {
		if (err instanceof ParseError && /Unreachable states detected/i.test(err.message)) {
			ok("ND-002 unreachable cycle rejected at parse time");
		} else {
			fail("ND-002 unreachable cycle parser rejection", `wrong error: ${(err as Error).message}`);
		}
	}
}

// ---------- ND-001: manualSetState rejects interactive targets ----------
{
	const cwd = mkdtempSync(join(tmpdir(), "sf-test-"));
	try {
		const sessionId = "sess-nd001";
		const sessionDir = await ensureSessionDir(cwd, sessionId);
		const fsmId = "nd001-fsm";
		const cfgObj = {
			task_description: "nd-001 fixture",
			states: [
				{
					state_id: "$START",
					state_desc: "start",
					is_epsilon: false,
					actions: [
						{
							action_id: "go",
							action_desc: "go gate",
							condition: { cmd: "node", args: ["../examples/scripts/always-true.mjs", "ok", "${$TAPE_FILE}"] },
							next_state_id: "gate",
						},
					],
				},
				{
					state_id: "gate",
					state_desc: "human gate",
					is_epsilon: false,
					interactive: true,
					actions: [
						{
							action_id: "pass",
							action_desc: "pass",
							condition: { cmd: "node", args: ["../examples/scripts/always-true.mjs", "ok", "${$TAPE_FILE}"] },
							next_state_id: "$END",
						},
					],
				},
				{ state_id: "$END", state_desc: "end", is_epsilon: false, actions: [] },
			],
		};
		const cfg = parseFlowConfig(JSON.stringify(cfgObj), "fixture.json");
		const parsed = buildFSM(cfg);
		const states: Record<string, unknown> = {};
		for (const [k, v] of parsed.states) states[k] = v;
		await writeFsmStructure(
			sessionDir,
			fsmId,
			"nd001-fixture",
			"/tmp",
			cfg.task_description ?? "nd-001 fixture",
			states as Record<string, never>,
		);
		await writeState(sessionDir, fsmId, "$START", []);
		const msg = await manualSetState(sessionDir, fsmId, "gate");
		if (/interactive/i.test(msg) && msg.startsWith("❌")) {
			ok("ND-001 manualSetState rejects interactive target");
		} else {
			fail("ND-001 manualSetState rejects interactive target", `unexpected reply: ${msg}`);
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

if (failed) process.exit(1);
console.log("\nAll regression tests passed.");
