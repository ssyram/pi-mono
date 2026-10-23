import assert from "node:assert/strict";
import test from "node:test";
import { buildFleetTree, clampTopForSelection, flattenVisible, windowRows, type FleetSourceRow } from "../src/tui/fleet-tree.ts";

function seededRows(count: number, parentOf: (index: number) => string | null): FleetSourceRow[] {
	return Array.from({ length: count }, (_, index) => ({ sessionId: `ses_${index}`, parentSessionId: parentOf(index), name: `w${index}` }));
}

test("buildFleetTree places every row under its parent with main as root", () => {
	const rows = seededRows(5, (index) => (index === 0 ? null : `ses_${index - 1}`));
	const tree = buildFleetTree(rows, "root");
	assert.equal(tree.key, "root");
	assert.equal(tree.children.length, 1);
	let node = tree.children[0]!;
	for (let index = 1; index < 5; index++) {
		assert.equal(node.children.length, 1);
		assert.equal(node.children[0]!.depth, index + 1);
		node = node.children[0]!;
	}
});

test("flattenVisible respects expansion and windowRows keeps the 7-line invariant", () => {
	const rows = seededRows(20, () => null);
	const tree = buildFleetTree(rows, "root");
	const flat = flattenVisible(tree, new Set());
	assert.equal(flat.length, 21);
	for (let top = 0; top < flat.length; top++) {
		const { lines } = windowRows(flat, top);
		assert.ok(lines.length <= 7, `top=${top} lines=${lines.length}`);
		const above = lines[0];
		const below = lines.at(-1);
		const hasAbove = above?.kind === "overflow-above";
		const hasBelow = below?.kind === "overflow-below";
		const entries = lines.filter((line) => line.kind === "entry").length;
		assert.equal(entries + Number(hasAbove) + Number(hasBelow), Math.min(7, flat.length - top + Number(top > 0)));
		if (hasAbove) assert.equal(above.hidden, top);
		if (hasBelow) assert.equal((below as { hidden: number }).hidden, flat.length - top - entries);
		if (!hasAbove && !hasBelow) assert.equal(entries, flat.length);
		if (hasAbove !== (top > 0) && top <= entries) assert.fail(`indicator mismatch at top=${top}`);
	}
});

test("single overflow indicator yields exactly one more entry than double", () => {
	const rows = seededRows(20, () => null);
	const flat = flattenVisible(buildFleetTree(rows, "root"), new Set());
	const both = windowRows(flat, 3);
	const onlyBelow = windowRows(flat, 0);
	const entries = (lines: ReturnType<typeof windowRows>["lines"]) => lines.filter((line) => line.kind === "entry").length;
	assert.equal(entries(both.lines), 5);
	assert.equal(entries(onlyBelow.lines), 6);
});

test("clampTopForSelection keeps the selected row inside the visible window", () => {
	const rows = seededRows(30, () => null);
	const flat = flattenVisible(buildFleetTree(rows, "root"), new Set());
	for (let index = 0; index < flat.length; index += 3) {
		const selected = flat[index]!.node.key;
		const top = clampTopForSelection(flat, selected, 0);
		const { lines } = windowRows(flat, top);
		assert.ok(lines.some((line) => line.kind === "entry" && line.row.node.key === selected), selected);
	}
});

test("expansion and collapse change the flattened row set", () => {
	const rows = [...seededRows(2, () => null), { sessionId: "ses_9", parentSessionId: "ses_0", name: "child" }];
	const tree = buildFleetTree(rows, "root");
	assert.equal(flattenVisible(tree, new Set()).length, 3);
	const expanded = flattenVisible(tree, new Set(["ses_0"]));
	assert.equal(expanded.length, 4);
	assert.ok(expanded.some((row) => row.node.key === "ses_9"));
});
