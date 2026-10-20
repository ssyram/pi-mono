import { execSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outputResult } from "./output.js";
import { parseArgs } from "./parse-args.js";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

let root: string;
let home: string;
let cwd: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "save-msg-output-"));
	home = join(root, "home");
	cwd = join(root, "work");
	await Promise.all([mkdir(home), mkdir(cwd)]);
	vi.stubEnv("HOME", home);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	await rm(root, { recursive: true, force: true });
});

async function save(
	path: string | undefined,
	append = false,
	text = "message",
) {
	const notices: { message: string; level: "info" | "warning" }[] = [];
	await outputResult(text, path, append, cwd, (message, level) =>
		notices.push({ message, level }),
	);
	return notices;
}

describe("outputResult paths", () => {
	it("writes a parsed ~/ path under the real temporary HOME, not a literal cwd/~", async () => {
		const parsed = parseArgs("~/out.md");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(parsed.error);
		const notices = await save(parsed.options.path);
		expect(await readFile(join(home, "out.md"), "utf8")).toBe("message");
		await expect(access(join(cwd, "~"))).rejects.toThrow();
		expect(notices).toEqual([
			{ message: `Saved to ${join(home, "out.md")}`, level: "info" },
		]);
	});
	it.each(["relative", "absolute"])(
		"preserves %s path resolution",
		async (kind) => {
			const target = join(cwd, "out.md");
			await save(kind === "absolute" ? target : "out.md");
			expect(await readFile(target, "utf8")).toBe("message");
		},
	);
	it("preserves overwrite and append for home paths", async () => {
		await save("~/out.md", false, "old");
		await save("~/out.md", false, "new");
		expect(await readFile(join(home, "out.md"), "utf8")).toBe("new");
		await save("~/out.md", true, "+append");
		expect(await readFile(join(home, "out.md"), "utf8")).toBe("new+append");
	});
	it("writes Unicode filenames", async () => {
		await save("~/结果.md");
		expect(await readFile(join(home, "结果.md"), "utf8")).toBe("message");
	});
	it("reports missing-parent failures without creating directories", async () => {
		const notices = await save("~/missing/out.md");
		expect(notices).toHaveLength(1);
		expect(notices[0]?.level).toBe("warning");
		expect(notices[0]?.message).toContain(
			`Failed to save to ${join(home, "missing/out.md")}`,
		);
		await expect(access(join(home, "missing"))).rejects.toThrow();
	});
	it("leaves pathless output on the isolated clipboard branch", async () => {
		vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
		expect(await save(undefined)).toEqual([
			{ message: "Copied to clipboard", level: "info" },
		]);
		expect(execSync).toHaveBeenCalledExactlyOnceWith("pbcopy", {
			input: "message",
		});
	});
});
