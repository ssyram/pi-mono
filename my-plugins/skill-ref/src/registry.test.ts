import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CommandLike, listEntries } from "./registry.js";

const COMMANDS: CommandLike[] = [
	{ name: "recap", description: "extension command", source: "extension", sourceInfo: { path: "/x/recap.ts" } },
	{ name: "pr-craft", description: "prompt", source: "prompt", sourceInfo: { path: "/p/pr-craft.md" } },
	{
		name: "skill:qpdi",
		description: "skill",
		source: "skill",
		sourceInfo: { path: "/s/qpdi/SKILL.md", baseDir: "/s/qpdi" },
	},
];

describe("listEntries", () => {
	it("keeps skills and prompts, drops extension commands", () => {
		assert.deepEqual(
			listEntries(() => COMMANDS).map((e) => e.qualifiedName),
			["prompt:pr-craft", "skill:qpdi"],
		);
	});

	it("strips the skill: prefix and carries path/baseDir through", () => {
		const skill = listEntries(() => COMMANDS).find((e) => e.kind === "skill");
		assert.equal(skill?.name, "qpdi");
		assert.equal(skill?.path, "/s/qpdi/SKILL.md");
		assert.equal(skill?.baseDir, "/s/qpdi");
	});

	it("defaults a missing description to an empty string", () => {
		const entries = listEntries(() => [{ name: "bare", source: "prompt" }]);
		assert.equal(entries[0]?.description, "");
		assert.equal(entries[0]?.path, "");
	});

	it("drops entries whose name is empty after prefix stripping", () => {
		assert.deepEqual(listEntries(() => [{ name: "skill:", source: "skill" }]), []);
	});

	it("returns [] instead of throwing when pi cannot answer", () => {
		assert.deepEqual(
			listEntries(() => {
				throw new Error("not initialized");
			}),
			[],
		);
	});
});
