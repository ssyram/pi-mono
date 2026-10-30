import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { resolveUserPath } from "../../file-path/resolve-user-path.js";
import { prepareScriptTask } from "../src/script-tasks/prepare-task.js";

const base = resolve("/work/project");
const home = resolve("/home/example");

test("save-msg regression: expand home before resolving relative paths", () => {
	for (const [input, expected] of [
		["~", home],
		["~/out.md", resolve(home, "out.md")],
		["~//nested/out.md", resolve(home, "nested/out.md")],
		["~/目录 with spaces/out.md", resolve(home, "目录 with spaces/out.md")],
		["out.md", resolve(base, "out.md")],
		["../out.md", resolve(base, "../out.md")],
		["/absolute/out.md", resolve("/absolute/out.md")],
		["", base],
		["$HOME/*.md", resolve(base, "$HOME/*.md")],
		["~someone/out", resolve(base, "~someone/out")],
	] as const)
		assert.equal(resolveUserPath(input, base, home), expected);
	assert.equal(resolveUserPath("~", base), homedir());
});

test("prepare defaults and resolve script relative to its own cwd", () => {
	const input = {
		wakeUp: { kind: "on-error", prompt: "check" },
		scripts: [
			{ path: "./check.sh" },
			{
				cwd: "../service",
				path: "./other.sh",
				params: ["a b", "$VAR", "*.txt"],
				timeoutSeconds: null,
			},
			{ cwd: "~/repo", path: "~/bin/check", timeoutSeconds: 0.5 },
		],
	};
	const before = structuredClone(input);
	const result = prepareScriptTask(input, base, home);
	assert.ok(result.ok);
	assert.deepEqual(result.task.wakeUp, {
		kind: "on-error",
		aggregation: "or",
		prompt: "check",
	});
	assert.deepEqual(result.task.scripts, [
		{
			cwd: base,
			path: resolve(base, "check.sh"),
			params: [],
			timeoutSeconds: 1800,
		},
		{
			cwd: resolve(base, "../service"),
			path: resolve(base, "../service/other.sh"),
			params: ["a b", "$VAR", "*.txt"],
			timeoutSeconds: null,
		},
		{
			cwd: resolve(home, "repo"),
			path: resolve(home, "bin/check"),
			params: [],
			timeoutSeconds: 0.5,
		},
	]);
	assert.deepEqual(input, before);
	const originalParams = input.scripts[1]?.params;
	assert.ok(originalParams);
	originalParams.push("new");
	assert.deepEqual(result.task.scripts[1]?.params, ["a b", "$VAR", "*.txt"]);
});

test("valid policy variants, absolute paths and empty pure prompt task", () => {
	for (const wakeUp of [
		{ kind: "never" },
		{ kind: "always", prompt: "" },
		{ kind: "on-error", prompt: "", aggregation: "and" },
		{ kind: "on-error", prompt: "", aggregation: "or" },
	]) {
		const result = prepareScriptTask(
			{ wakeUp, scripts: [{ cwd: "/absolute", path: "/bin/sh" }] },
			base,
			home,
		);
		assert.ok(result.ok);
		assert.equal(result.task.scripts[0]?.path, resolve("/bin/sh"));
	}
	assert.ok(
		prepareScriptTask(
			{ wakeUp: { kind: "always", prompt: "" }, scripts: [] },
			base,
		).ok,
	);
});

test("invalid JSON structure and empty non-actionable tasks return errors", () => {
	const invalid: unknown[] = [
		null,
		[],
		"x",
		3,
		{},
		{ scripts: [] },
		{ wakeUp: null, scripts: [] },
		{ wakeUp: [], scripts: [] },
		{ wakeUp: { kind: "unknown" }, scripts: [] },
		{ wakeUp: { kind: "always", prompt: 1 }, scripts: [] },
		{
			wakeUp: { kind: "on-error", prompt: "x", aggregation: "xor" },
			scripts: [{}],
		},
		{ wakeUp: { kind: "never" }, scripts: [] },
		{ wakeUp: { kind: "on-error", prompt: "x" }, scripts: [] },
		{ wakeUp: { kind: "always", prompt: "x" }, scripts: {} },
	];
	for (const input of invalid) {
		const result = prepareScriptTask(input, base);
		assert.equal(result.ok, false, JSON.stringify(input));
		if (!result.ok) assert.ok(result.error.length > 0);
	}
});

test("script validation covers every field and preserves null timeout", () => {
	const invalid: unknown[] = [
		null,
		[],
		4,
		{},
		{ path: "" },
		{ path: 3 },
		{ path: "x", cwd: "" },
		{ path: "x", cwd: null },
		{ path: "x", params: null },
		{ path: "x", params: [1] },
		...[0, -1, Infinity, NaN, "1800", Number.MAX_SAFE_INTEGER].map(
			(timeoutSeconds) => ({ path: "x", timeoutSeconds }),
		),
	];
	for (const script of invalid) {
		assert.equal(
			prepareScriptTask(
				{ wakeUp: { kind: "never" }, scripts: [{ path: "valid" }, script] },
				base,
			).ok,
			false,
		);
	}
	for (const timeoutSeconds of [null, 0.001, 1800, 2147484]) {
		const result = prepareScriptTask(
			{ wakeUp: { kind: "never" }, scripts: [{ path: "x", timeoutSeconds }] },
			base,
		);
		assert.ok(result.ok);
		assert.equal(result.task.scripts[0]?.timeoutSeconds, timeoutSeconds);
	}
});

test("liveSocketPath stays direct when short and hashes into tmpdir when the run dir is deep", async () => {
	const { liveSocketPath } = await import("../src/script-tasks/live-socket.js");
	const { isAbsolute, join: pathJoin } = await import("node:path");
	const shortDir = resolve("/w/.pi/scheduled-wakeup/v2/runs/t1/r1");
	assert.equal(liveSocketPath(shortDir), pathJoin(shortDir, "live.sock"));

	const deepDir = resolve("/Users/ssyram/workspace/ai-tools/pi-mono/.pi/scheduled-wakeup/v2/runs/session:01234567-89ab-cdef-0123-456789abcdef/1793333959533-2438366f");
	const hashed = liveSocketPath(deepDir);
	assert.ok(hashed.length <= 100, `hashed path must stay bindable, got ${hashed.length}`);
	assert.ok(isAbsolute(hashed) && hashed.includes("pi-sw-live-"), "deep run dirs relocate under tmpdir with a marked name");
	assert.equal(hashed, liveSocketPath(deepDir), "hashing is deterministic for both runner and prober");
	assert.notEqual(hashed, liveSocketPath(`${deepDir}x`), "different run dirs hash to different sockets");
});
