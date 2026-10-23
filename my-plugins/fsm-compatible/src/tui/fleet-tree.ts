export interface FleetSourceRow {
	readonly sessionId: string;
	readonly parentSessionId: string | null;
	readonly name: string | null;
	readonly runActive?: boolean;
}

export interface FleetNode {
	readonly key: string;
	readonly name: string;
	readonly shortId: string;
	readonly depth: number;
	readonly children: FleetNode[];
	readonly runActive?: boolean;
}

export interface FleetFlatRow {
	readonly node: FleetNode;
	readonly hasChildren: boolean;
	readonly expanded: boolean;
}

export type FleetLine =
	| { kind: "overflow-above"; hidden: number }
	| { kind: "overflow-below"; hidden: number }
	| { kind: "entry"; row: FleetFlatRow };

export const FLEET_MAX_LINES = 7;

export function shortIdOf(sessionId: string): string {
	return sessionId.length > 11 ? sessionId.slice(0, 11) : sessionId;
}

export function buildFleetTree(rows: Iterable<FleetSourceRow>, rootSessionId: string, rootName = "main"): FleetNode {
	const root: FleetNode = { key: rootSessionId, name: rootName, shortId: shortIdOf(rootSessionId), depth: 0, children: [] };
	const nodes = new Map<string, FleetNode>([[rootSessionId, root]]);
	for (const row of rows) {
		const key = row.sessionId;
		const node: FleetNode = { key, name: row.name ?? "agent", shortId: shortIdOf(key), depth: 1, children: [], ...(row.runActive !== undefined ? { runActive: row.runActive } : {}) };
		nodes.set(key, node);
	}
	for (const row of rows) {
		const node = nodes.get(row.sessionId);
		if (!node || node === root) continue;
		const parent = nodes.get(row.parentSessionId ?? rootSessionId) ?? root;
		if (parent === node) continue;
		parent.children.push(node);
	}
	// Active children first, done/idle children at the end of each parent's list.
	const sortChildren = (node: FleetNode) => {
		node.children.sort((a, b) => Number(b.runActive ?? false) - Number(a.runActive ?? false));
		for (const child of node.children) sortChildren(child);
	};
	sortChildren(root);
	const assignDepth = (node: FleetNode, depth: number, seen: Set<string>) => {
		if (seen.has(node.key)) return;
		seen.add(node.key);
		for (const child of node.children) {
			(child as { depth: number }).depth = depth + 1;
			assignDepth(child, depth + 1, seen);
		}
	};
	assignDepth(root, 0, new Set());
	return root;
}

export function flattenVisible(root: FleetNode, expanded: Set<string>): FleetFlatRow[] {
	const flat: FleetFlatRow[] = [];
	const visit = (node: FleetNode) => {
		const hasChildren = node.children.length > 0;
		const isExpanded = hasChildren && (node.depth === 0 || expanded.has(node.key));
		flat.push({ node, hasChildren, expanded: isExpanded });
		if (isExpanded) for (const child of node.children) visit(child);
	};
	visit(root);
	return flat;
}

export function windowRows(flat: readonly FleetFlatRow[], top: number, maxLines: number = FLEET_MAX_LINES): { lines: FleetLine[]; top: number } {
	const length = flat.length;
	if (length === 0) return { lines: [], top: 0 };
	let start = Math.max(0, Math.min(top, length - 1));
	let count: number;
	if (start === 0) {
		count = Math.min(maxLines, length);
		if (count < length) count = Math.min(maxLines - 1, length);
	} else {
		count = Math.min(maxLines - 1, length - start);
		if (start + count < length) count = Math.max(1, maxLines - 2);
	}
	const lines: FleetLine[] = [];
	if (start > 0) lines.push({ kind: "overflow-above", hidden: start });
	for (let index = start; index < start + count && index < length; index++) lines.push({ kind: "entry", row: flat[index]! });
	if (start + count < length) lines.push({ kind: "overflow-below", hidden: length - start - count });
	return { lines, top: start };
}

export function clampTopForSelection(flat: readonly FleetFlatRow[], selected: string, top: number, maxLines: number = FLEET_MAX_LINES): number {
	const index = flat.findIndex((row) => row.node.key === selected);
	if (index < 0) return top;
	const visible = maxLines - 2;
	if (index < top) return index;
	if (index >= top + visible) return Math.max(0, index - visible + 1);
	return top;
}
