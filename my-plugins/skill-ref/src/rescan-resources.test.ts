import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CommandLike } from "./registry.js";
import { isPinnedSource, rescanResources } from "./rescan-resources.js";

function command(name: string, path: string, description = ""): CommandLike {
	return { name, description, source: "skill", sourceInfo: { path, baseDir: path.replace(/\/SKILL\.md$/, "") } };
}

describe("isPinnedSource", () => {
	it("pins command-line and extension-bundled provenance, nothing pi discovers from disk", () => {
		assert.ok(isPinnedSource("cli"));
		assert.ok(isPinnedSource("extension:index"));
		assert.ok(!isPinnedSource("auto"));
		assert.ok(!isPinnedSource("local"));
		assert.ok(!isPinnedSource("package"));
	});
});

describe("rescanResources", () => {
	function fixture(): { root: string; agentDir: string; cwd: string; skillDir: string } {
		const root = mkdtempSync(join(tmpdir(), "skill-ref-rescan-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		const skillDir = join(agentDir, "skills", "foo");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: foo\ndescription: Foo skill\n---\nbody\n");
		mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "prompts", "bar.md"), "---\ndescription: Bar prompt\n---\ncontent\n");
		return { root, agentDir, cwd, skillDir };
	}

	it("projects skills and prompts found on disk, pinned resources first", async () => {
		const { root, agentDir, cwd, skillDir } = fixture();
		try {
			const entries = await rescanResources({
				cwd,
				agentDir,
				pinnedCommands: () => [command("skill:pinned", "/pinned/SKILL.md", "from the command line")],
			});
			assert.deepEqual(
				entries.map((e) => [e.qualifiedName, e.description]),
				[
					["skill:pinned", "from the command line"],
					["prompt:bar", "Bar prompt"],
					["skill:foo", "Foo skill"],
				],
			);
			assert.equal(entries[2]?.path, join(skillDir, "SKILL.md"));
			assert.equal(entries[2]?.baseDir, skillDir);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("lets a pinned resource win a name collision with the disk", async () => {
		const { root, agentDir, cwd } = fixture();
		try {
			const entries = await rescanResources({
				cwd,
				agentDir,
				pinnedCommands: () => [command("skill:foo", "/bundled/foo/SKILL.md", "bundled with an extension")],
			});
			assert.deepEqual(
				entries.map((e) => [e.qualifiedName, e.description]),
				[
					["skill:foo", "bundled with an extension"],
					["prompt:bar", "Bar prompt"],
				],
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
