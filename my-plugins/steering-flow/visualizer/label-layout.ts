import { createRequire } from "module";
const require = createRequire(import.meta.url);

/**
 * Server-side label placement with force-based collision avoidance.
 * Runs in Node.js — no DOM/getBBox needed.
 * Text width is estimated at ~7px per character (11px sans-serif bold, rounded up).
 */

export interface LabelBox {
	/** label text */
	text: string;
	/** ideal x (edge midpoint) */
	idealX: number;
	/** ideal y (edge midpoint) */
	idealY: number;
	/** final x after avoidance */
	x: number;
	/** final y after avoidance */
	y: number;
	/** estimated full width including padding */
	w: number;
	/** estimated full height including padding */
	h: number;
}

const CHAR_WIDTH = 7;
const FONT_HEIGHT = 13;
const PAD_X = 20;
const PAD_Y = 10;

function estimateBox(text: string, mx: number, my: number): LabelBox {
	const w = text.length * CHAR_WIDTH + PAD_X;
	const h = FONT_HEIGHT + PAD_Y;
	return { text, idealX: mx, idealY: my, x: mx, y: my, w, h };
}

function overlaps(a: LabelBox, b: LabelBox, pad = 4): boolean {
	return (
		a.x - a.w / 2 - pad < b.x + b.w / 2 + pad &&
		a.x + a.w / 2 + pad > b.x - b.w / 2 - pad &&
		a.y - a.h / 2 - pad < b.y + b.h / 2 + pad &&
		a.y + a.h / 2 + pad > b.y - b.h / 2 - pad
	);
}

/**
 * Run force-based label avoidance.
 * @param labels - array of LabelBox (mutated in place)
 * @param iterations - simulation steps (default 80)
 */
function forceAvoid(labels: LabelBox[], iterations = 80): void {
	if (labels.length < 2) return;

	const springStrength = 0.25;
	const repulsion = 1.2;
	const damping = 0.6;

	for (let iter = 0; iter < iterations; iter++) {
		const vx = new Float64Array(labels.length);
		const vy = new Float64Array(labels.length);

		// repulsion between overlapping labels
		for (let i = 0; i < labels.length; i++) {
			for (let j = i + 1; j < labels.length; j++) {
				const a = labels[i];
				const b = labels[j];
				if (!overlaps(a, b, 6)) continue;

				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const overlapX =
					(a.w + b.w) / 2 + 6 - Math.abs(dx);
				const overlapY =
					(a.h + b.h) / 2 + 6 - Math.abs(dy);

				if (overlapX > 0 && overlapY > 0) {
					// push along axis of least overlap
					if (overlapX < overlapY) {
						const push =
							(dx >= 0 ? 1 : -1) *
							overlapX *
							repulsion *
							0.5;
						vx[i] -= push;
						vx[j] += push;
					} else {
						const push =
							(dy >= 0 ? 1 : -1) *
							overlapY *
							repulsion *
							0.5;
						vy[i] -= push;
						vy[j] += push;
					}
				}
			}
		}

		// spring back to ideal position
		for (let i = 0; i < labels.length; i++) {
			vx[i] += (labels[i].idealX - labels[i].x) * springStrength;
			vy[i] += (labels[i].idealY - labels[i].y) * springStrength;
		}

		// apply
		for (let i = 0; i < labels.length; i++) {
			labels[i].x += vx[i] * damping;
			labels[i].y += vy[i] * damping;
		}
	}
}

export interface EdgeLayout {
	srcId: string;
	tgtId: string;
	actionId: string;
	label: LabelBox;
	/** dagre routing waypoints for the edge polyline */
	points: { x: number; y: number }[];
}

export interface NodePos {
	id: string;
	x: number;
	y: number;
}

export interface LayoutResult {
	nodes: NodePos[];
	edges: EdgeLayout[];
	graphWidth: number;
	graphHeight: number;
	warnings?: string[];
}

export interface FsmState {
	id: string;
	actions: { id: string; nextStateId: string }[];
}

/**
 * Run dagre layout + label avoidance for an FSM.
 * Returns node positions, edge label positions, and graph dimensions.
 */
export function layoutFsm(
	states: FsmState[],
	nodeRadius: number,
): LayoutResult {
	// biome-ignore lint/suspicious/noExplicitAny: dagre is CJS-only
	const dagre = require("dagre") as any;

	const g = new dagre.graphlib.Graph({ multigraph: true })
		.setGraph({
			rankdir: "TB",
			nodesep: 70,
			ranksep: 100,
			marginx: 40,
			marginy: 40,
		})
		.setDefaultEdgeLabel(() => ({}));

	for (const s of states) {
		g.setNode(s.id, {
			label: s.id,
			width: nodeRadius * 2 + 80,
			height: nodeRadius * 2 + 20,
		});
	}

	const warnings: string[] = [];
	const stateIds = new Set(states.map((s) => s.id));
	for (const s of states) {
		for (const a of s.actions) {
			if (!stateIds.has(a.nextStateId)) {
				warnings.push(`Dangling transition: ${s.id} -> ${a.nextStateId} (state not found)`);
				continue;
			}
			g.setEdge(
				s.id,
				a.nextStateId,
				{ label: a.id, action: a },
				a.id,
			);
		}
	}

	dagre.layout(g);

	const nodes: NodePos[] = states.map((s) => {
		const n = g.node(s.id);
		return { id: s.id, x: n.x, y: n.y };
	});

	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	const labels: LabelBox[] = [];
	const edgeEntries: {
		srcId: string;
		tgtId: string;
		actionId: string;
		points: { x: number; y: number }[];
	}[] = [];

	for (const e of g.edges()) {
		const ed = g.edge(e);
		const pts: { x: number; y: number }[] = ed.points;

		/* Find label position at arc-length midpoint of the dagre polyline */
		const segs: number[] = [];
		let totalLen = 0;
		for (let i = 1; i < pts.length; i++) {
			const dx = pts[i].x - pts[i - 1].x;
			const dy = pts[i].y - pts[i - 1].y;
			const len = Math.sqrt(dx * dx + dy * dy);
			segs.push(len);
			totalLen += len;
		}
		let walk = totalLen / 2;
		let mx = pts[0].x;
		let my = pts[0].y;
		for (let i = 0; i < segs.length; i++) {
			if (walk <= segs[i]) {
				const t = walk / segs[i];
				mx = pts[i].x + t * (pts[i + 1].x - pts[i].x);
				my = pts[i].y + t * (pts[i + 1].y - pts[i].y);
				break;
			}
			walk -= segs[i];
		}

		labels.push(estimateBox(ed.label, mx, my));
		edgeEntries.push({
			srcId: e.v,
			tgtId: e.w,
			actionId: e.name,
			points: pts.map((p) => ({ x: p.x, y: p.y })),
		});
	}

	forceAvoid(labels);

	const edges: EdgeLayout[] = edgeEntries.map((entry, i) => ({
		...entry,
		label: labels[i],
	}));

	const graph = g.graph();
	return {
		nodes,
		edges,
		graphWidth: graph.width ?? 400,
		graphHeight: graph.height ?? 300,
		warnings,
	};
}
