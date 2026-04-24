import type { VisualizerDocument } from "./types.js";
import { layoutFsm } from "./label-layout.js";
import { dragNodesCode } from "./drag-nodes.js";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function safeJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

const NODE_RADIUS = 28;

export function renderVisualizerHtml(doc: VisualizerDocument): string {
	const layouts = doc.fsms.map((fsm) => layoutFsm(fsm.states, NODE_RADIUS));
	const data = safeJson(doc);
	const layoutsJson = safeJson(layouts);
	const title = escapeHtml(doc.title);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7"><\/script>
<style>
:root { color-scheme:dark; }
* { box-sizing:border-box; margin:0; padding:0; }
body { background:#0d1117; color:#e6edf3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; overflow:hidden; }

/* header */
header { position:fixed; inset:0 0 auto 0; height:56px; z-index:10; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 20px; background:rgba(13,17,23,.96); border-bottom:1px solid #30363d; backdrop-filter:blur(8px); }
header h1 { font-size:16px; font-weight:600; color:#e6edf3; }
header .sub { color:#8b949e; font-size:12px; margin-top:2px; }
.pill { display:inline-block; padding:2px 8px; border:1px solid #30363d; border-radius:999px; color:#8b949e; font-size:11px; margin-left:6px; }

/* layout */
main { display:grid; grid-template-columns:1fr 360px; height:100vh; padding-top:56px; }
#graph { width:100%; height:calc(100vh - 56px); background:radial-gradient(ellipse at 30% 20%, #161b22 0%, #0d1117 60%); cursor:grab; }
#graph:active { cursor:grabbing; }

/* sidebar */
aside { border-left:1px solid #30363d; background:#161b22; overflow-y:auto; padding:14px; }
select { width:100%; margin-bottom:12px; background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:8px 10px; font-size:13px; }
.section { background:#0d1117; border:1px solid #30363d; border-radius:8px; padding:12px; margin-bottom:10px; }
.section h2 { font-size:13px; font-weight:600; margin-bottom:8px; color:#e6edf3; }
pre { white-space:pre-wrap; word-break:break-all; overflow:auto; max-height:240px; margin:0; color:#8b949e; font-size:12px; font-family:'SF Mono',Consolas,monospace; }
.row { margin:6px 0; color:#c9d1d9; font-size:13px; }
.muted { color:#8b949e; }
.kv { display:grid; grid-template-columns:100px 1fr; gap:4px; font-size:12px; }

/* nodes */
.node { cursor:pointer; }
.node circle { fill:#161b22; stroke:#30363d; stroke-width:2; transition:stroke .15s, fill .15s, opacity .15s; }
.node text { fill:#e6edf3; font-size:11px; pointer-events:none; transition:opacity .15s; }
.node .label { font-weight:600; font-size:12px; }
.node .sublabel { fill:#8b949e; font-size:10px; }
.node.current circle { stroke:#58a6ff; stroke-width:3; }
.node.epsilon circle { stroke-dasharray:5 4; }
.node.start circle { stroke:#3fb950; }
.node.start.current circle { stroke:#3fb950; stroke-width:3; }
.node.end circle { stroke:#f85149; }
.node.end.current circle { stroke:#f85149; stroke-width:3; }

/* highlight states */
.node.highlight circle { stroke:#58a6ff; stroke-width:3; fill:#1f2937; }
.node.highlight-1 circle { stroke:#58a6ff; stroke-width:2; fill:#1a2332; opacity:.38; transition-delay:.08s; }
.node.highlight-2 circle { stroke:#58a6ff; stroke-width:1.5; fill:#171f2b; opacity:.22; transition-delay:.16s; }
.node.highlight-3 circle { stroke:#58a6ff; stroke-width:1; fill:#151b24; opacity:.2; transition-delay:.24s; }
.node.dim { opacity:.15; }
.node.dim circle { stroke:#30363d; }

/* edges */
.edge-path { fill:none; stroke:#8b949e; stroke-width:1.5; opacity:.2; transition:stroke .15s, stroke-width .15s, opacity .15s; }
.edge-path.highlight { stroke:#58a6ff; stroke-width:2.5; opacity:.85; }
.edge-path.highlight-1 { stroke:#58a6ff; stroke-width:2; opacity:.38; transition-delay:.08s; }
.edge-path.highlight-2 { stroke:#58a6ff; stroke-width:1.5; opacity:.22; transition-delay:.16s; }
.edge-path.highlight-3 { stroke:#58a6ff; stroke-width:1; opacity:.2; transition-delay:.24s; }
.edge-path.dim { opacity:.04; }

/* edge labels */
.edge-label { cursor:pointer; transition:opacity .15s; }
.edge-label rect { fill:#2d1f0e; stroke:#d29922; stroke-width:1; rx:999; ry:999; }
.edge-label text { fill:#e8b44a; font-size:11px; font-weight:600; pointer-events:none; letter-spacing:.3px; }
.edge-label.highlight rect { stroke:#f5d060; stroke-width:2; fill:#3d2c0a; }
.edge-label.highlight text { fill:#fde68a; }
.edge-label.highlight-1 rect { stroke:#d29922; stroke-width:1; fill:#2d1f0e; opacity:.38; transition-delay:.08s; }
.edge-label.highlight-1 text { fill:#e8b44a; opacity:.38; }
.edge-label.highlight-2 rect { stroke:#d29922; stroke-width:1; fill:#2d1f0e; opacity:.22; transition-delay:.16s; }
.edge-label.highlight-2 text { fill:#e8b44a; opacity:.22; }
.edge-label.highlight-3 rect { stroke:#d29922; stroke-width:1; fill:#2d1f0e; opacity:.2; transition-delay:.24s; }
.edge-label.highlight-3 text { fill:#e8b44a; opacity:.2; }
.edge-label.dim { opacity:.12; }

/* tooltip */
.tooltip { position:fixed; pointer-events:none; z-index:20; background:rgba(13,17,23,.98); border:1px solid #30363d; border-radius:8px; padding:10px 12px; font-size:12px; color:#c9d1d9; max-width:280px; opacity:0; transition:opacity .12s; box-shadow:0 4px 12px rgba(0,0,0,.4); }
.tooltip.visible { opacity:1; }
.tooltip b { color:#e6edf3; }
.tooltip .tt-muted { color:#8b949e; font-size:11px; }

/* legend */
.legend { position:fixed; left:14px; bottom:14px; color:#8b949e; font-size:11px; background:rgba(22,27,34,.9); border:1px solid #30363d; border-radius:8px; padding:10px 14px; z-index:5; line-height:1.8; }
.legend kbd { background:#21262d; border:1px solid #30363d; border-radius:3px; padding:1px 5px; font-size:10px; font-family:inherit; }
.legend-row { display:flex; align-items:center; gap:6px; }
.legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; border:2px solid; flex-shrink:0; }
.legend-line { display:inline-block; width:18px; height:0; border-top:2px solid; flex-shrink:0; }
</style>
</head>
<body>
<header>
  <div><h1>${title}</h1><div class="sub" id="subtitle"></div></div>
  <div><span class="pill" id="mode"></span><span class="pill" id="counts"></span></div>
</header>
<main>
  <svg id="graph"></svg>
  <aside>
    <select id="fsmSelect"></select>
    <div id="details"></div>
  </aside>
</main>
<div class="tooltip" id="tooltip"></div>
<div class="legend">
  <div class="legend-row"><span class="legend-dot" style="border-color:#3fb950;background:#161b22"></span> Start</div>
  <div class="legend-row"><span class="legend-dot" style="border-color:#f85149;background:#161b22"></span> End</div>
  <div class="legend-row"><span class="legend-dot" style="border-color:#58a6ff;background:#161b22"></span> Current</div>
  <div class="legend-row"><span class="legend-dot" style="border-color:#30363d;background:#161b22;border-style:dashed"></span> Epsilon</div>
  <div class="legend-row" style="margin-top:4px"><span class="legend-line" style="border-color:#8b949e;opacity:.4"></span> Transition</div>
  <div class="legend-row"><span class="legend-line" style="border-color:#58a6ff;border-width:2.5px"></span> Highlighted</div>
  <div style="margin-top:6px;border-top:1px solid #30363d;padding-top:6px">
    Hover/Click: highlight outgoing · <kbd>Esc</kbd> clear<br>
    Drag to pan · Scroll to zoom
  </div>
  <button id="resetBtn" style="margin-top:8px;width:100%;padding:4px 0;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;transition:background .12s" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='#21262d'">Reset View</button>
</div>
<script>
const DOC = ${data};
var LAYOUTS = ${layoutsJson};
var NODE_R = ${NODE_RADIUS};

${dragNodesCode}

/* refs */
const svg = d3.select('#graph');
const defs = svg.append('defs');
const root = svg.append('g');
const tooltip = document.getElementById('tooltip');
const details = document.getElementById('details');
const fsmSelect = document.getElementById('fsmSelect');

/* arrowhead marker */
defs.append('marker').attr('id','arrow').attr('viewBox','0 0 10 10').attr('refX',10).attr('refY',5)
  .attr('markerWidth',8).attr('markerHeight',8).attr('orient','auto-start-reverse')
  .append('path').attr('d','M 0 0 L 10 5 L 0 10 z').attr('fill','#8b949e');

/* zoom */
const zoom = d3.zoom().scaleExtent([0.2, 3]).on('zoom', e => root.attr('transform', e.transform));
svg.call(zoom);
svg.on('dblclick.zoom', null);

/* header info */
document.getElementById('subtitle').textContent = DOC.sourceLabel + ' \\u00b7 ' + DOC.generatedAt;
document.getElementById('mode').textContent = DOC.sourceMode;
document.getElementById('counts').textContent = DOC.fsms.length + ' FSM(s)';
DOC.fsms.forEach(function(fsm, i) {
  var opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = (fsm.id === DOC.activeFsmId ? '\\u25cf ' : '') + fsm.name;
  fsmSelect.appendChild(opt);
});
fsmSelect.value = String(Math.max(0, DOC.fsms.findIndex(function(f) { return f.id === DOC.activeFsmId; })));
fsmSelect.addEventListener('change', function() { renderFsm(Number(fsmSelect.value)); });

/* helpers */
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function jsonBlock(v) { return '<pre>' + esc(JSON.stringify(v, null, 2)) + '</pre>'; }

/* sidebar panels */
function showOverview(fsm) {
  details.innerHTML =
    '<div class="section"><h2>' + esc(fsm.name) + '</h2>' +
    '<div class="kv"><span class="muted">ID</span><span>' + esc(fsm.id) + '</span></div>' +
    '<div class="kv"><span class="muted">Current</span><span style="color:#58a6ff">' + esc(fsm.currentStateId || 'n/a') + '</span></div>' +
    '<div class="kv"><span class="muted">Flow dir</span><span>' + esc(fsm.flowDir || '(none)') + '</span></div>' +
    '<div class="kv"><span class="muted">Tape path</span><span>' + esc(fsm.tapePath || 'static file') + '</span></div>' +
    '</div>' +
    '<div class="section"><h2>Task</h2><pre>' + esc(fsm.taskDescription) + '</pre></div>' +
    '<div class="section"><h2>Tape</h2>' + jsonBlock(fsm.tape) + '</div>' +
    '<div class="section"><h2>Transitions</h2>' + jsonBlock(fsm.transitionLog) + '</div>' +
    '<div class="section"><h2>Commands (' + DOC.commands.length + ')</h2>' +
      DOC.commands.map(function(c) { return '<div class="row"><b>' + esc(c.name) + '</b><br><span class="muted">' + esc(c.description) + '</span></div>'; }).join('') +
    '</div>' +
    '<div class="section"><h2>Tools (' + DOC.tools.length + ')</h2>' +
      DOC.tools.map(function(t) { return '<div class="row"><b>' + esc(t.name) + '</b><br><span class="muted">' + esc(t.description) + '</span></div>'; }).join('') +
    '</div>';
}

function showState(fsm, state) {
  details.innerHTML =
    '<div class="section"><h2>State \\u00b7 ' + esc(state.id) + '</h2>' +
    (state.isEpsilon ? '<span class="pill">\\u03b5 epsilon</span> ' : '') +
    (state.id === fsm.currentStateId ? '<span class="pill" style="border-color:#58a6ff;color:#58a6ff">current</span>' : '') +
    '<pre style="margin-top:8px">' + esc(state.description) + '</pre></div>' +
    '<div class="section"><h2>Actions (' + state.actions.length + ')</h2>' +
    (state.actions.length
      ? state.actions.map(function(a) {
          return '<div class="row"><b>' + esc(a.id) + '</b> \\u2192 <span style="color:#58a6ff">' + esc(a.nextStateId) + '</span>' +
          '<br><span class="muted">' + esc(a.description) + '</span>' +
          '<br><span class="muted">condition: ' + esc(a.conditionSummary) + '</span></div>';
        }).join('')
      : '<div class="muted">Terminal state</div>') +
    '</div>';
}

function showAction(action) {
  details.innerHTML =
    '<div class="section"><h2>Action \\u00b7 ' + esc(action.id) + '</h2>' +
    '<div class="kv"><span class="muted">Next state</span><span style="color:#58a6ff">' + esc(action.nextStateId) + '</span></div>' +
    (action.isDefault ? '<span class="pill" style="border-color:#f0883e;color:#f0883e">default</span>' : '') +
    '<pre style="margin-top:8px">' + esc(action.description) + '</pre></div>' +
    '<div class="section"><h2>Arguments (' + action.arguments.length + ')</h2>' +
    (action.arguments.length
      ? action.arguments.map(function(a) { return '<div class="row"><b>' + esc(a.name) + '</b><br><span class="muted">' + esc(a.description) + '</span></div>'; }).join('')
      : '<div class="muted">No arguments</div>') +
    '</div>' +
    '<div class="section"><h2>Condition</h2><pre>' + esc(action.conditionDetail) + '</pre></div>';
}

/* tooltip */
function showTooltip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('visible');
  var x = Math.min(evt.clientX + 14, window.innerWidth - 300);
  var y = Math.min(evt.clientY + 14, window.innerHeight - 100);
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
function hideTooltip() { tooltip.classList.remove('visible'); }

/* highlight state */
var lockedNodeId = null;
var currentFsmData = null;

function buildAdjacency(fsm) {
  var pred = {}, succ = {};
  fsm.states.forEach(function(s) { pred[s.id] = []; succ[s.id] = []; });
  fsm.states.forEach(function(s) {
    s.actions.forEach(function(a) {
      if (succ[s.id]) succ[s.id].push(a.nextStateId);
      if (pred[a.nextStateId]) pred[a.nextStateId].push(s.id);
    });
  });
  return { pred: pred, succ: succ };
}

var HL_LEVELS = ['highlight', 'highlight-1', 'highlight-2', 'highlight-3'];
var MAX_CASCADE = 3;

function buildEpsilonSet(fsm) {
  var eps = new Set();
  fsm.states.forEach(function(s) { if (s.isEpsilon) eps.add(s.id); });
  return eps;
}

function getOutgoingLeveled(startId, adj, epsilonSet) {
  var nodeLevel = {};
  var edgeLevel = {};
  nodeLevel[startId] = -1;

  var queue = [];
  (adj.succ[startId] || []).forEach(function(s) {
    edgeLevel[startId + '\u2192' + s] = 0;
    if (!(s in nodeLevel)) { nodeLevel[s] = 0; queue.push({ id: s, level: 0 }); }
  });

  while (queue.length > 0) {
    var cur = queue.shift();
    if (!epsilonSet.has(cur.id) || cur.level >= MAX_CASCADE) continue;
    var nextLevel = cur.level + 1;
    (adj.succ[cur.id] || []).forEach(function(s) {
      var eKey = cur.id + '\u2192' + s;
      if (!(eKey in edgeLevel)) {
        edgeLevel[eKey] = nextLevel;
        if (!(s in nodeLevel)) {
          nodeLevel[s] = nextLevel;
          queue.push({ id: s, level: nextLevel });
        }
      }
    });
  }

  return { nodeLevel: nodeLevel, edgeLevel: edgeLevel };
}

function applyHighlight(stateId) {
  if (!currentFsmData) return;
  var epsilonSet = buildEpsilonSet(currentFsmData.fsm);
  var result = getOutgoingLeveled(stateId, currentFsmData.adj, epsilonSet);
  var nodeLevel = result.nodeLevel, edgeLevel = result.edgeLevel;

  d3.selectAll('.node').each(function(d) {
    var el = d3.select(this);
    var level = nodeLevel[d.id];
    var isHl = level !== undefined;
    HL_LEVELS.forEach(function(cls) { el.classed(cls, false); });
    el.classed('dim', !isHl);
    if (isHl) {
      var cls = level < 0 ? 'highlight' : (HL_LEVELS[Math.min(level, MAX_CASCADE)] || HL_LEVELS[MAX_CASCADE]);
      el.classed(cls, true);
    }
  });
  d3.selectAll('.edge-group').each(function(d) {
    var key = d.src + '\u2192' + d.tgt;
    var level = edgeLevel[key];
    var isHl = level !== undefined;
    var paths = d3.select(this).selectAll('.edge-path');
    var label = d3.select(this).select('.edge-label');
    HL_LEVELS.forEach(function(cls) { paths.classed(cls, false); label.classed(cls, false); });
    paths.classed('dim', !isHl);
    label.classed('dim', !isHl);
    if (isHl) {
      var cls = HL_LEVELS[Math.min(level, MAX_CASCADE)] || HL_LEVELS[MAX_CASCADE];
      paths.classed(cls, true);
      label.classed(cls, true);
    }
  });
}

function clearHighlight() {
  lockedNodeId = null;
  d3.selectAll('.node').each(function() {
    var el = d3.select(this);
    HL_LEVELS.forEach(function(cls) { el.classed(cls, false); });
    el.classed('dim', false);
  });
  d3.selectAll('.edge-path').each(function() {
    var el = d3.select(this);
    HL_LEVELS.forEach(function(cls) { el.classed(cls, false); });
    el.classed('dim', false);
  });
  d3.selectAll('.edge-label').each(function() {
    var el = d3.select(this);
    HL_LEVELS.forEach(function(cls) { el.classed(cls, false); });
    el.classed('dim', false);
  });
}

/* background click */
var _downPos = null;
svg.node().addEventListener('pointerdown', function(e) { _downPos = { x: e.clientX, y: e.clientY }; });
svg.node().addEventListener('pointerup', function(e) {
  if (!_downPos) return;
  var dx = e.clientX - _downPos.x, dy = e.clientY - _downPos.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  _downPos = null;
  if (dist < 5 && !e.target.closest('.node') && !e.target.closest('.edge-group')) {
    clearHighlight();
    if (currentFsmData) showOverview(currentFsmData.fsm);
  }
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { clearHighlight(); if (currentFsmData) showOverview(currentFsmData.fsm); }
});

/* Build two SVG path strings from a dagre points array, split at the label position.
     Segment 1: first point → ... → label (no arrowhead).
     Segment 2: label → ... → last point (arrowhead). */
function polylineSplit(pts, lx, ly) {
  if (!pts || pts.length < 2) {
    return { d1: 'M'+lx+','+ly, d2: 'M'+lx+','+ly };
  }
  /* Find the segment closest to the label midpoint and insert it */
  var bestIdx = 0, bestDist = 1e9;
  for (var i = 0; i < pts.length - 1; i++) {
    /* project label onto segment i→i+1 */
    var ax = pts[i].x, ay = pts[i].y, bx = pts[i+1].x, by = pts[i+1].y;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx*dx + dy*dy;
    var t = len2 > 0 ? Math.max(0, Math.min(1, ((lx-ax)*dx + (ly-ay)*dy) / len2)) : 0;
    var px = ax + t*dx, py = ay + t*dy;
    var dist = (lx-px)*(lx-px) + (ly-py)*(ly-py);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  /* d1: pts[0..bestIdx] → label */
  var d1 = 'M' + pts[0].x + ',' + pts[0].y;
  for (var i = 1; i <= bestIdx; i++) d1 += ' L' + pts[i].x + ',' + pts[i].y;
  d1 += ' L' + lx + ',' + ly;
  /* d2: label → pts[bestIdx+1..end] */
  var d2 = 'M' + lx + ',' + ly;
  for (var i = bestIdx + 1; i < pts.length; i++) d2 += ' L' + pts[i].x + ',' + pts[i].y;
  return { d1: d1, d2: d2 };
}

var _initPos = {}, _nodePos = {}, _edgeGroups = null;
function renderFsm(fsmIndex) {
  var fsm = DOC.fsms[fsmIndex];
  var layout = LAYOUTS[fsmIndex];
  if (!fsm || !layout) return;

  root.selectAll('*').remove();
  clearHighlight();
  showOverview(fsm);

  var adj = buildAdjacency(fsm);
  currentFsmData = { fsm: fsm, adj: adj };

  var nodeR = NODE_R;

  /* build node position lookup */
  var nodePos = {};
  layout.nodes.forEach(function(n) { nodePos[n.id] = n; });

  /* remember initial positions for reset */
  var initPos = {};
  layout.nodes.forEach(function(n) { initPos[n.id] = { x: n.x, y: n.y }; });
  _initPos = initPos;
  _nodePos = nodePos;

  /* build action lookup for edge data */
  var actionMap = {};
  fsm.states.forEach(function(s) {
    s.actions.forEach(function(a) { actionMap[s.id + '\\0' + a.nextStateId + '\\0' + a.id] = a; });
  });

  /* edges from pre-computed layout */
  var edgeData = layout.edges.map(function(e) {
    var src = nodePos[e.srcId], tgt = nodePos[e.tgtId];
    if (!src || !tgt) return null;
    var action = actionMap[e.srcId + '\\0' + e.tgtId + '\\0' + e.actionId];
    return {
      src: e.srcId, tgt: e.tgtId, name: e.actionId,
      edge: { label: e.actionId, action: action },
      srcNode: { x: src.x, y: src.y }, tgtNode: { x: tgt.x, y: tgt.y },
      labelX: e.label.x, labelY: e.label.y,
      labelW: e.label.w, labelH: e.label.h,
      points: e.points
    };
  }).filter(Boolean);

  var edgeGroups = root.append('g').attr('class','edges')
    .selectAll('g').data(edgeData).enter().append('g').attr('class','edge-group');
  _edgeGroups = edgeGroups;

  edgeGroups.each(function(d) {
    var g = d3.select(this);
    /* Clamp first/last dagre point onto circle edge (radius = nodeR) */
    var pts = d.points.slice();
    if (pts.length >= 2) {
      var s = d.srcNode, dx0 = pts[0].x - s.x, dy0 = pts[0].y - s.y;
      var len0 = Math.sqrt(dx0*dx0 + dy0*dy0) || 1;
      pts[0] = { x: s.x + dx0/len0*nodeR, y: s.y + dy0/len0*nodeR };
      var t = d.tgtNode, last = pts.length-1, dx1 = pts[last].x - t.x, dy1 = pts[last].y - t.y;
      var len1 = Math.sqrt(dx1*dx1 + dy1*dy1) || 1;
      pts[last] = { x: t.x + dx1/len1*nodeR, y: t.y + dy1/len1*nodeR };
    }
    var seg = polylineSplit(pts, d.labelX, d.labelY);
    g.append('path').attr('class','edge-path edge-path-1').attr('d', seg.d1);
    g.append('path').attr('class','edge-path edge-path-2').attr('d', seg.d2).attr('marker-end','url(#arrow)');
  });

  /* edge labels at pre-computed positions */
  var edgeLabels = edgeGroups.append('g').attr('class','edge-label')
    .attr('transform', function(d) {
      return 'translate(' + d.labelX + ',' + d.labelY + ')';
    });
  edgeLabels.each(function(d) {
    var el = d3.select(this);
    el.append('text').attr('text-anchor','middle').attr('dy','0.35em').text(d.edge.label);
    var hw = d.labelW / 2, hh = d.labelH / 2;
    el.insert('rect','text').attr('x', -hw).attr('y', -hh).attr('width', d.labelW).attr('height', d.labelH);
  });
  edgeLabels.on('mouseenter', function(evt, d) {
    if (!lockedNodeId) {
      clearHighlight();
      var srcId = d.src, tgtId = d.tgt;
      d3.selectAll('.node').each(function(nd) {
        var el = d3.select(this);
        var isHl = (nd.id === srcId || nd.id === tgtId);
        el.classed('highlight', isHl).classed('dim', !isHl);
      });
      d3.selectAll('.edge-group').each(function(ed) {
        var isHl = (ed.src === srcId && ed.tgt === tgtId);
        d3.select(this).selectAll('.edge-path').classed('highlight', isHl).classed('dim', !isHl);
        d3.select(this).select('.edge-label').classed('highlight', isHl).classed('dim', !isHl);
      });
    }
    if (!d.edge.action) { hideTooltip(); return; }
    showTooltip(evt, '<b>' + esc(d.edge.action.id) + '</b>' +
      '<br><span class="tt-muted">' + esc(d.src) + ' \\u2192 ' + esc(d.tgt) + '</span>' +
      '<br><span class="tt-muted">' + esc(d.edge.action.conditionSummary || '') + '</span>');
  });
  edgeLabels.on('mousemove', function(evt) {
    tooltip.style.left = Math.min(evt.clientX + 14, window.innerWidth - 300) + 'px';
    tooltip.style.top = Math.min(evt.clientY + 14, window.innerHeight - 100) + 'px';
  });
  edgeLabels.on('mouseleave', function() {
    hideTooltip();
    if (!lockedNodeId) clearHighlight();
  });
  edgeLabels.on('click', function(_e, d) { if (!d.edge.action) return; showAction(d.edge.action); });

  /* nodes */
  var nodes = root.append('g').attr('class','nodes')
    .selectAll('g').data(fsm.states).enter().append('g')
    .attr('class', function(s) {
      var c = 'node';
      if (s.id === '$START') c += ' start';
      if (s.id === '$END') c += ' end';
      if (s.isEpsilon) c += ' epsilon';
      if (s.id === fsm.currentStateId) c += ' current';
      return c;
    })
    .attr('transform', function(s) { var n = nodePos[s.id]; if (!n) return 'translate(0,0)'; return 'translate(' + n.x + ',' + n.y + ')'; });

  nodes.append('circle').attr('r', nodeR);
  nodes.append('text').attr('class','label').attr('text-anchor','middle').attr('dy', '-0.15em')
    .text(function(s) { return s.id.length > 12 ? s.id.slice(0, 11) + '\\u2026' : s.id; });
  nodes.append('text').attr('class','sublabel').attr('text-anchor','middle').attr('dy', '1.2em')
    .text(function(s) { return s.actions.length + ' action' + (s.actions.length !== 1 ? 's' : ''); });

  /* node interactions */
  nodes.on('mouseenter', function(evt, s) {
    if (!lockedNodeId) applyHighlight(s.id);
    showTooltip(evt, '<b>' + esc(s.id) + '</b>' +
      (s.isEpsilon ? ' <span class="tt-muted">\\u03b5</span>' : '') +
      '<br><span class="tt-muted">' + s.actions.length + ' action(s)</span>' +
      (s.id === fsm.currentStateId ? '<br><span style="color:#58a6ff">\\u25cf current state</span>' : ''));
  });
  nodes.on('mousemove', function(evt) {
    tooltip.style.left = Math.min(evt.clientX + 14, window.innerWidth - 300) + 'px';
    tooltip.style.top = Math.min(evt.clientY + 14, window.innerHeight - 100) + 'px';
  });
  nodes.on('mouseleave', function() {
    hideTooltip();
    if (!lockedNodeId) clearHighlight();
  });
  nodes.on('click', function(evt, s) {
    evt.stopPropagation();
    if (lockedNodeId === s.id) { clearHighlight(); showOverview(fsm); }
    else { lockedNodeId = s.id; applyHighlight(s.id); showState(fsm, s); }
  });
  nodes.on('dblclick', function(evt, s) {
    evt.stopPropagation();
    lockedNodeId = s.id;
    applyHighlight(s.id);
    showState(fsm, s);
  });

  /* enable drag on nodes */
  if (typeof enableDragNodes === 'function') enableDragNodes(nodes, nodePos, edgeGroups, nodeR);

  /* auto-fit */
  var gw = Math.max(layout.graphWidth, 1), gh = Math.max(layout.graphHeight, 1);
  var svgEl = svg.node();
  if (svgEl) {
    var box = svgEl.getBoundingClientRect();
    var scale = Math.min(1.4, Math.max(0.3, Math.min(box.width / gw, box.height / gh) * 0.85));
    svg.call(zoom.transform, d3.zoomIdentity
      .translate((box.width - gw * scale) / 2, (box.height - gh * scale) / 2)
      .scale(scale));
  }
}

renderFsm(Number(fsmSelect.value) || 0);

document.getElementById('resetBtn').addEventListener('click', function() {
  if (!currentFsmData) return;
  clearHighlight();
  showOverview(currentFsmData.fsm);

  /* animate nodes back to initial positions */
  var dur = 800;
  d3.selectAll('.node').transition().duration(dur).ease(d3.easeCubicOut)
    .attr('transform', function(s) {
      var p = _initPos[s.id];
      if (!p || !_nodePos[s.id]) return d3.select(this).attr('transform');
      _nodePos[s.id].x = p.x;
      _nodePos[s.id].y = p.y;
      return 'translate(' + p.x + ',' + p.y + ')';
    })
    .on('end', function() {
      /* redraw edges after nodes settle */
      d3.selectAll('.edge-group').each(function(d) {
        var g = d3.select(this);
        /* restore original layout points regardless of whether nodes are positioned */
        var layoutEdge = LAYOUTS[Number(fsmSelect.value) || 0].edges.find(function(e) {
          return e.srcId === d.src && e.tgtId === d.tgt && e.actionId === d.name;
        });
        if (layoutEdge) {
          d.points = layoutEdge.points;
          d.labelX = layoutEdge.label.x;
          d.labelY = layoutEdge.label.y;
        }
        var src = _nodePos[d.src], tgt = _nodePos[d.tgt];
        if (!src || !tgt) return;
        d.srcNode = { x: src.x, y: src.y };
        d.tgtNode = { x: tgt.x, y: tgt.y };
        var nodeR = NODE_R;
        var pts = d.points.slice();
        if (pts.length >= 2) {
          var s = d.srcNode, dx0 = pts[0].x - s.x, dy0 = pts[0].y - s.y;
          var len0 = Math.sqrt(dx0*dx0 + dy0*dy0) || 1;
          pts[0] = { x: s.x + dx0/len0*nodeR, y: s.y + dy0/len0*nodeR };
          var t = d.tgtNode, last = pts.length-1, dx1 = pts[last].x - t.x, dy1 = pts[last].y - t.y;
          var len1 = Math.sqrt(dx1*dx1 + dy1*dy1) || 1;
          pts[last] = { x: t.x + dx1/len1*nodeR, y: t.y + dy1/len1*nodeR };
        }
        var seg = polylineSplit(pts, d.labelX, d.labelY);
        g.select('.edge-path-1').attr('d', seg.d1);
        g.select('.edge-path-2').attr('d', seg.d2);
        g.select('.edge-label').attr('transform', 'translate(' + d.labelX + ',' + d.labelY + ')');
      });
    });


});
<\/script>
</body>
</html>`;
}