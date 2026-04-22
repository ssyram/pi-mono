import type { VisualizerDocument } from "./types.js";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function safeJson(value: VisualizerDocument): string {
	return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

export function renderVisualizerHtml(doc: VisualizerDocument): string {
	const data = safeJson(doc);
	const title = escapeHtml(doc.title);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"></script>
<style>
:root { color-scheme: dark; --bg:#0b1020; --panel:#11182b; --panel2:#16213a; --text:#e6edf7; --muted:#8ea0bc; --accent:#68d391; --warn:#f6ad55; --edge:#7f8ea3; --current:#63b3ed; --end:#fc8181; }
* { box-sizing: border-box; } body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
header { position:fixed; inset:0 0 auto 0; height:74px; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; background:rgba(11,16,32,.94); border-bottom:1px solid #24324e; }
h1 { font-size:18px; margin:0 0 4px; } .sub { color:var(--muted); font-size:12px; } .pill { display:inline-block; padding:2px 8px; border:1px solid #31415f; border-radius:999px; color:#c9d7ec; font-size:12px; margin-left:6px; }
main { display:grid; grid-template-columns: minmax(0, 1fr) 380px; height:100vh; padding-top:74px; }
#graph { width:100%; height:calc(100vh - 74px); background:radial-gradient(circle at 20% 20%, #17213a 0, #0b1020 36%); }
aside { border-left:1px solid #24324e; background:var(--panel); overflow:auto; padding:14px; }
select { width:100%; margin-bottom:12px; background:#0d1426; color:var(--text); border:1px solid #31415f; border-radius:6px; padding:8px; }
.section { background:var(--panel2); border:1px solid #263756; border-radius:10px; padding:12px; margin:0 0 12px; } .section h2 { font-size:14px; margin:0 0 8px; }
pre { white-space:pre-wrap; overflow:auto; max-height:260px; margin:0; color:#cbd5e1; font-size:12px; }
.node rect { fill:#19243d; stroke:#5b6f91; stroke-width:1.4; rx:10; } .node.current rect { stroke:var(--current); stroke-width:3; } .node.end rect { stroke:var(--end); } .node.start rect { stroke:var(--accent); } .node.epsilon rect { stroke-dasharray:5 4; }
.node text { fill:var(--text); font-size:12px; pointer-events:none; } .edgePath path { stroke:var(--edge); stroke-width:1.5; fill:none; } .edgeLabel { color:var(--text); font-size:11px; } .edgeLabel div { background:#0d1426; border:1px solid #31415f; border-radius:999px; padding:2px 6px; }
.edgePath.highlight path { stroke:var(--accent); stroke-width:3; } .node.dim, .edgePath.dim, .edgeLabel.dim { opacity:.28; }
.row { margin:6px 0; color:#cbd5e1; font-size:13px; } .muted { color:var(--muted); } .kv { display:grid; grid-template-columns:110px 1fr; gap:6px; }
.buttonlike { cursor:pointer; } .legend { position:fixed; left:14px; bottom:14px; color:var(--muted); font-size:12px; background:rgba(17,24,43,.86); border:1px solid #24324e; border-radius:8px; padding:8px 10px; }
</style>
</head>
<body>
<header><div><h1>${title}</h1><div class="sub" id="subtitle"></div></div><div><span class="pill" id="mode"></span><span class="pill" id="counts"></span></div></header>
<main><svg id="graph"></svg><aside><select id="fsmSelect"></select><div id="details"></div></aside></main><div class="legend">Click nodes/edges for details · drag/scroll to pan/zoom · current state is blue</div>
<script>
const DOC = ${data};
const svg = d3.select('#graph');
const root = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.2, 2.5]).on('zoom', event => root.attr('transform', event.transform));
svg.call(zoom);
const details = document.getElementById('details');
const select = document.getElementById('fsmSelect');
document.getElementById('subtitle').textContent = DOC.sourceLabel + ' · generated ' + DOC.generatedAt;
document.getElementById('mode').textContent = DOC.sourceMode;
document.getElementById('counts').textContent = DOC.fsms.length + ' FSM(s)';
DOC.fsms.forEach((fsm, i) => { const opt = document.createElement('option'); opt.value = String(i); opt.textContent = (fsm.id === DOC.activeFsmId ? 'TOP · ' : '') + fsm.name; select.appendChild(opt); });
select.value = String(Math.max(0, DOC.fsms.findIndex(f => f.id === DOC.activeFsmId)));
select.addEventListener('change', () => renderFsm(DOC.fsms[Number(select.value)]));
function htmlEscape(s) { return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function jsonBlock(v) { return '<pre>' + htmlEscape(JSON.stringify(v, null, 2)) + '</pre>'; }
function showOverview(fsm) { details.innerHTML = '<div class="section"><h2>' + htmlEscape(fsm.name) + '</h2><div class="row muted">' + htmlEscape(fsm.id) + '</div><div class="row">Current: <b>' + htmlEscape(fsm.currentStateId || 'n/a') + '</b></div><div class="row">Flow dir: ' + htmlEscape(fsm.flowDir || '(none)') + '</div><div class="row">Tape path: ' + htmlEscape(fsm.tapePath || '(static file mode)') + '</div></div><div class="section"><h2>Task</h2><pre>' + htmlEscape(fsm.taskDescription) + '</pre></div><div class="section"><h2>Tape</h2>' + jsonBlock(fsm.tape) + '</div><div class="section"><h2>Transition history</h2>' + jsonBlock(fsm.transitionLog) + '</div><div class="section"><h2>Commands</h2>' + DOC.commands.map(c => '<div class="row"><b>' + htmlEscape(c.name) + '</b><br><span class="muted">' + htmlEscape(c.description) + '</span></div>').join('') + '</div><div class="section"><h2>Tools</h2>' + DOC.tools.map(t => '<div class="row"><b>' + htmlEscape(t.name) + '</b><br><span class="muted">' + htmlEscape(t.description) + '</span></div>').join('') + '</div>'; }
function showState(fsm, state) { details.innerHTML = '<div class="section"><h2>State · ' + htmlEscape(state.id) + '</h2><div class="row">' + (state.isEpsilon ? '<span class="pill">epsilon</span>' : '') + (state.id === fsm.currentStateId ? '<span class="pill">current</span>' : '') + '</div><pre>' + htmlEscape(state.description) + '</pre></div><div class="section"><h2>Actions</h2>' + (state.actions.length ? state.actions.map(a => '<div class="row"><b>' + htmlEscape(a.id) + '</b> → ' + htmlEscape(a.nextStateId) + '<br><span class="muted">' + htmlEscape(a.description) + '</span><br><span class="muted">condition: ' + htmlEscape(a.conditionSummary) + '</span></div>').join('') : '<div class="muted">No actions</div>') + '</div>'; }
function showAction(action) { details.innerHTML = '<div class="section"><h2>Action · ' + htmlEscape(action.id) + '</h2><div class="row">Next: <b>' + htmlEscape(action.nextStateId) + '</b></div><pre>' + htmlEscape(action.description) + '</pre></div><div class="section"><h2>Arguments</h2>' + (action.arguments.length ? action.arguments.map(a => '<div class="row"><b>' + htmlEscape(a.name) + '</b><br><span class="muted">' + htmlEscape(a.description) + '</span></div>').join('') : '<div class="muted">No action arguments</div>') + '</div><div class="section"><h2>Condition</h2><pre>' + htmlEscape(action.conditionDetail) + '</pre></div>'; }
function renderFsm(fsm) { root.selectAll('*').remove(); showOverview(fsm); const g = new dagre.graphlib.Graph().setGraph({ rankdir:'TB', nodesep:55, ranksep:80, marginx:30, marginy:30 }).setDefaultEdgeLabel(() => ({})); fsm.states.forEach(s => g.setNode(s.id, { label:s.id, width:170, height:62 })); fsm.states.forEach(s => s.actions.forEach(a => g.setEdge(s.id, a.nextStateId, { label:a.id, action:a }, a.id))); dagre.layout(g); const edge = root.append('g').selectAll('g').data(g.edges()).enter().append('g').attr('class','edgePath buttonlike'); edge.append('path').attr('d', e => { const pts = g.edge(e).points; return d3.line().x(p=>p.x).y(p=>p.y)(pts); }); edge.on('click', (_event, e) => showAction(g.edge(e).action)); const labels = root.append('g').selectAll('foreignObject').data(g.edges()).enter().append('foreignObject').attr('class','edgeLabel buttonlike').attr('width',150).attr('height',28).attr('x', e => g.edge(e).x - 75).attr('y', e => g.edge(e).y - 14); labels.append('xhtml:div').text(e => g.edge(e).label); labels.on('click', (_event, e) => showAction(g.edge(e).action)); const nodes = root.append('g').selectAll('g').data(fsm.states).enter().append('g').attr('class', s => 'node buttonlike ' + (s.id === '$START' ? 'start ' : '') + (s.id === '$END' ? 'end ' : '') + (s.isEpsilon ? 'epsilon ' : '') + (s.id === fsm.currentStateId ? 'current ' : '')).attr('transform', s => { const n = g.node(s.id); return 'translate(' + (n.x - n.width/2) + ',' + (n.y - n.height/2) + ')'; }); nodes.append('rect').attr('width',170).attr('height',62); nodes.append('text').attr('x',85).attr('y',27).attr('text-anchor','middle').text(s => s.id); nodes.append('text').attr('x',85).attr('y',45).attr('text-anchor','middle').attr('fill','#8ea0bc').text(s => s.actions.length + ' action(s)'); nodes.on('click', (_event, s) => showState(fsm, s)); const graph = g.graph(); const svgNode = svg.node(); if (svgNode) { const box = svgNode.getBoundingClientRect(); const scale = Math.min(1.2, Math.max(0.35, Math.min(box.width / Math.max(graph.width,1), box.height / Math.max(graph.height,1)) * 0.82)); svg.call(zoom.transform, d3.zoomIdentity.translate((box.width - graph.width * scale)/2, 40).scale(scale)); } }
renderFsm(DOC.fsms[Number(select.value)] || DOC.fsms[0]);
</script>
</body>
</html>`;
}
