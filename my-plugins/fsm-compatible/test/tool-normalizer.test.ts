import assert from "node:assert/strict";
import test from "node:test";
import { isFsmProjectedTool, normalizeToolCall } from "../src/gates/tool-normalizer.ts";

test("normalizer maps Pi/OC tool names and params to CC canonical form", () => {
	// read: Pi path / OC filePath / CC file_path all → Read + file_path
	// HC hook canonical keeps every model field, renaming only the path key.
	assert.deepEqual(normalizeToolCall({ toolName: "read", input: { path: "/a/b.txt", offset: 2 } }),
		{ toolName: "Read", toolInput: { file_path: "/a/b.txt", offset: 2 } });
	assert.deepEqual(normalizeToolCall({ toolName: "read", input: { filePath: "/a/b.txt" } }),
		{ toolName: "Read", toolInput: { file_path: "/a/b.txt" } });
	assert.deepEqual(normalizeToolCall({ toolName: "Read", input: { file_path: "/a/b.txt" } }),
		{ toolName: "Read", toolInput: { file_path: "/a/b.txt" } });
	assert.deepEqual(normalizeToolCall({ toolName: "read", input: {} }), { toolName: "Read", toolInput: {} });
	// write: content carried, path in any convention
	assert.deepEqual(normalizeToolCall({ toolName: "write", input: { path: "/a.txt", content: "x" } }),
		{ toolName: "Write", toolInput: { file_path: "/a.txt", content: "x" } });
	assert.deepEqual(normalizeToolCall({ toolName: "write", input: { filePath: "/a.txt", content: "x" } }),
		{ toolName: "Write", toolInput: { file_path: "/a.txt", content: "x" } });
	// bash: command picked, CC name
	assert.deepEqual(normalizeToolCall({ toolName: "bash", input: { command: "git status", timeout: 5000 } }),
		{ toolName: "Bash", toolInput: { command: "git status", timeout: 5000 } });
	assert.deepEqual(normalizeToolCall({ toolName: "shell", input: { command: "ls" } }),
		{ toolName: "Bash", toolInput: { command: "ls" } });
	// grep: glob/include → glob
	assert.deepEqual(normalizeToolCall({ toolName: "grep", input: { pattern: "n", path: "/w", glob: "*.ts" } }),
		{ toolName: "Grep", toolInput: { pattern: "n", path: "/w", glob: "*.ts" } });
	assert.deepEqual(normalizeToolCall({ toolName: "grep", input: { pattern: "n", include: "*.ts" } }),
		{ toolName: "Grep", toolInput: { pattern: "n", glob: "*.ts" } });
	// find (Pi) and glob (OC) → Glob
	assert.deepEqual(normalizeToolCall({ toolName: "find", input: { pattern: "*.md", path: "/w" } }),
		{ toolName: "Glob", toolInput: { pattern: "*.md", path: "/w" } });
	assert.deepEqual(normalizeToolCall({ toolName: "glob", input: { pattern: "*.md" } }),
		{ toolName: "Glob", toolInput: { pattern: "*.md" } });
	// ls → LS
	assert.deepEqual(normalizeToolCall({ toolName: "ls", input: { path: "/w" } }),
		{ toolName: "LS", toolInput: { path: "/w" } });
});

test("edit maps single pairs to Edit and arrays to MultiEdit exactly once", () => {
	assert.deepEqual(normalizeToolCall({ toolName: "edit", input: { path: "/a", oldText: "x", newText: "y" } }),
		{ toolName: "Edit", toolInput: { file_path: "/a", old_string: "x", new_string: "y" } });
	assert.deepEqual(normalizeToolCall({ toolName: "edit", input: { filePath: "/a", oldString: "x", newString: "y" } }),
		{ toolName: "Edit", toolInput: { file_path: "/a", old_string: "x", new_string: "y" } });
	assert.deepEqual(normalizeToolCall({ toolName: "edit", input: { file_path: "/a", old_string: "x", new_string: "y" } }),
		{ toolName: "Edit", toolInput: { file_path: "/a", old_string: "x", new_string: "y" } });
	assert.deepEqual(normalizeToolCall({ toolName: "edit", input: { path: "/a", edits: [{ oldText: "x", newText: "y" }, { old_string: "p", new_string: "q" }] } }),
		{ toolName: "MultiEdit", toolInput: { file_path: "/a", edits: [{ old_string: "x", new_string: "y" }, { old_string: "p", new_string: "q" }] } });
	assert.throws(() => normalizeToolCall({ toolName: "edit", input: { path: "/a", edits: [{ oldText: 1, newText: "y" }] } }));
});

test("subagent names unify to Agent; unknown and mcp tools pass through", () => {
	assert.deepEqual(normalizeToolCall({ toolName: "subagent", input: { task: "x" } }),
		{ toolName: "Agent", toolInput: { task: "x" } });
	assert.deepEqual(normalizeToolCall({ toolName: "task", input: { task: "x" } }),
		{ toolName: "Agent", toolInput: { task: "x" } });
	assert.deepEqual(normalizeToolCall({ toolName: "web_search", input: { query: "x" } }),
		{ toolName: "web_search", toolInput: { query: "x" } });
	assert.deepEqual(normalizeToolCall({ toolName: "mcp__other__tool", input: { a: 1 } }),
		{ toolName: "mcp__other__tool", toolInput: { a: 1 } });
	const nested = normalizeToolCall({ toolName: "bash/1", input: { command: "ls" } });
	assert.equal(nested.toolName, "bash/1");
});

test("fsm-projected tools include both mcp and oc alias prefixes", () => {
	assert.equal(isFsmProjectedTool("mcp__fsm__fsm_get_state"), true);
	assert.equal(isFsmProjectedTool("fsm_enter_fsm"), true);
	assert.equal(isFsmProjectedTool("fsm_try_transition"), true);
	assert.equal(isFsmProjectedTool("read"), false);
	assert.equal(isFsmProjectedTool("bash"), false);
});
