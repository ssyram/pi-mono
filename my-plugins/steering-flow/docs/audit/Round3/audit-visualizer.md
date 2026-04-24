# Hoare Audit — Dimension D3: Visualizer Module Correctness
**Scope**: `my-plugins/steering-flow/visualizer/`  
**Files audited**: `index.ts`, `types.ts`, `normalize-state.ts`, `document.ts`, `create-artifact.ts`, `render-html.ts`, `label-layout.ts`, `drag-nodes.ts`, and the root `index.ts` invocation sites.  
**Date**: 2026-04-24  
**Round**: 3  

---

## Summary

| ID | File | Severity | Title |
|---|---|---|---|
| D3-001 | `create-artifact.ts:16,27` | **CRITICAL** | Arbitrary file-write and file-read via unvalidated LLM-supplied paths |
| D3-002 | `create-artifact.ts:16,27` + `index.ts:469–473` | **HIGH** | Post-condition violated: output is not required to land inside `cwd` |
| D3-003 | `render-html.ts:35` | **MEDIUM** | CDN dependency loaded without Subresource Integrity (SRI) hash |
| D3-004 | `label-layout.ts:200–213` | **MEDIUM** | Missing `pts.length > 0` guard — crash on empty dagre edge point array |
| D3-005 | `label-layout.ts:170–176` | **MEDIUM** | Phantom-node invariant: edges to undeclared states silently corrupt layout |
| D3-006 | `label-layout.ts:52–100` | **LOW** | O(iterations × n²) repulsion loop — quadratic wall time on large FSMs |
| D3-007 | `document.ts:40` | **LOW** | Silent drop of individual FSM load failures with no user-visible warning |
| D3-008 | `render-html.ts:407` | **LOW** | Silent early-return swallows render errors — blank visualizer with no feedback |

---

## Detailed Findings

---

### D3-001 — Arbitrary File-Write and File-Read via Unvalidated LLM-Supplied Paths
**Severity**: CRITICAL  
**Files**: `visualizer/create-artifact.ts:16,27` · `index.ts:469–473`

#### Violated Invariant
> **Security invariant (implicit):** All filesystem operations initiated by an LLM-supplied tool call MUST be confined to the session working directory (`cwd`). Absolute paths supplied by external callers MUST be rejected or sanitized.

#### The Code
```typescript
// create-artifact.ts:12-16
function resolveOutputPath(cwd: string, outputFile?: string): string {
    if (!outputFile)
        return resolve(cwd, ".pi", DEFAULT_ARTIFACT_NAME);
    return isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
    //                              ^^^^^^^^^^^^^^^^^^^^^^^^^
    //                              If absolute: used verbatim, no check.
}

// create-artifact.ts:27
const absFlow = isAbsolute(options.flowFile)
    ? options.flowFile                  // ← arbitrary read
    : resolve(options.cwd, options.flowFile);

// create-artifact.ts:42-43
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, "utf8");  // ← arbitrary write
```

```typescript
// index.ts:469-473 — MCP tool invocation, no intermediate validation
createVisualizerArtifact({
    cwd,
    sessionId,
    flowFile:   params.flow_file,    // LLM-supplied, Type.Optional(Type.String)
    outputFile: params.output_file,  // LLM-supplied, Type.Optional(Type.String)
});
```

#### Counterexample
An LLM (or a compromised prompt) invokes the registered MCP tool `create-steering-flow-visualizer` with:

```json
{
  "output_file": "/etc/cron.d/pwned",
  "flow_file":   "/etc/passwd"
}
```

- `resolveOutputPath` receives `"/etc/cron.d/pwned"` → `isAbsolute` is `true` → returns `"/etc/cron.d/pwned"` unmodified.
- `writeFile("/etc/cron.d/pwned", html)` executes — injecting attacker-controlled content into the cron directory (on systems where the Node process has sufficient permissions).
- `fsReadFile("/etc/passwd")` executes — contents are parsed as a `.flow` config; the resulting parse error or partial FSM structure is harmless to the attacker, but the read itself is unconstrained and any file's content that survives `parseFlowConfig` could leak into the HTML output artifact.

A path-traversal variant using a relative path also works:
```json
{ "output_file": "../../.ssh/authorized_keys" }
```
`resolve(cwd, "../../.ssh/authorized_keys")` exits `cwd` silently.

#### Missing Pre-condition
```
Pre(resolveOutputPath):
  outputFile ∈ {undefined} ∪ { p : !isAbsolute(p) ∧ normalize(resolve(cwd,p)).startsWith(normalize(cwd)) }
```
No such precondition is checked; the function accepts the full string domain.

#### Fix Direction
After resolving the final path, assert `resolvedPath.startsWith(path.resolve(cwd))` and throw `Error("Output path escapes working directory")` for both `outputFile` and `flowFile`. Accept only paths that normalize to within `cwd`.

---

### D3-002 — Post-condition Violated: Output Path Not Constrained to `cwd`
**Severity**: HIGH  
**Files**: `visualizer/create-artifact.ts:16,43` · `visualizer/types.ts:52–56`

#### Violated Post-condition
> **Post(createVisualizerArtifact):** `result.outputPath` is a path inside `options.cwd` (or the default `.pi/` subdirectory thereof).

The `VisualizerArtifactResult.outputPath` field is documented by the tool description as *"defaults to `.pi/steering-flow-visualizer.html` under cwd"*, implying cwd containment is the guaranteed post-condition. The implementation falsifies this when an absolute path is supplied.

#### Counterexample
```typescript
const result = await createVisualizerArtifact({
    cwd: "/home/user/project",
    sessionId: "abc",
    outputFile: "/tmp/evil.html",
});
// result.outputPath === "/tmp/evil.html"
// Postcondition says: result.outputPath.startsWith("/home/user/project") — FALSE
```

The returned `result.outputPath` is `/tmp/evil.html`, violating the cwd-containment post-condition.

---

### D3-003 — CDN Dependency Loaded Without Subresource Integrity (SRI)
**Severity**: MEDIUM  
**File**: `visualizer/render-html.ts:35`

#### Violated Invariant
> **Supply-chain invariant:** Any third-party script embedded in generated HTML artifacts MUST include an `integrity` attribute so that tampering by the CDN or a MITM is detected by the browser.

#### The Code
```typescript
// render-html.ts:35 (inside the HTML template literal)
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
```
No `integrity="sha384-..."` attribute is present.

#### Counterexample
If `cdn.jsdelivr.net` is compromised, DNS-poisoned, or the npm package is maliciously updated under the same semver range (`@7`), the browser will execute the attacker's JavaScript in the context of the HTML artifact. Because the artifact is typically opened from a `file://` URL by the developer's browser, the attack surface is the developer's local machine — clipboard access, localStorage of other `file://` pages, etc.

A correct tag:
```html
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"
        integrity="sha384-<hash>"
        crossorigin="anonymous"></script>
```

Additionally, the tag pins `d3@7` (major only), meaning any future breaking change or malicious patch in d3 v7.x is automatically fetched.

---

### D3-004 — Missing Guard on Empty `pts` Array Before `pts[0]` Access
**Severity**: MEDIUM  
**File**: `visualizer/label-layout.ts:200–214`

#### Violated Pre-condition
> **Pre(arc-length midpoint block):** `pts.length ≥ 1`  
> (dagre normally guarantees ≥ 2 points per edge, but this is undocumented and unasserted)

#### The Code
```typescript
// label-layout.ts:200-214
const pts: { x: number; y: number }[] = ed.points;   // dagre edge points

const segs: number[] = [];
let totalLen = 0;
for (let i = 1; i < pts.length; i++) {               // safe if pts.length === 0
    …
    segs.push(len);
    totalLen += len;
}
let walk = totalLen / 2;
let mx = pts[0].x;   // ← CRASH if pts.length === 0 → TypeError: Cannot read properties of undefined
let my = pts[0].y;
```

#### Counterexample
An FSM where a self-loop state has `actions: [{ id: "retry", nextStateId: "A" }]` and dagre returns `ed.points = []` (which can occur with certain dagre versions for degenerate same-source/target edges) causes:

```
TypeError: Cannot read properties of undefined (reading 'x')
    at computeLayout (label-layout.ts:213)
```

The entire `createVisualizerArtifact` call throws, leaving no HTML output.

#### Fix Direction
```typescript
if (pts.length === 0) {
    // fallback: place label at source node position
    mx = g.node(e.v).x;
    my = g.node(e.v).y;
} else {
    let mx = pts[0].x;
    let my = pts[0].y;
    …
}
```

---

### D3-005 — Phantom-Node Invariant: Edges to Undeclared States Corrupt Layout
**Severity**: MEDIUM  
**File**: `visualizer/label-layout.ts:170–176`

#### Violated Invariant
> **Layout consistency invariant:** For every edge `(src → tgt)` in `layout.edges`, both `src` and `tgt` MUST be present in `layout.nodes`. Otherwise, `render-html.ts`'s `nodePos[e.srcId]` / `nodePos[e.tgtId]` lookup returns `undefined`, causing a null-dereference at layout-to-render handoff.

#### The Code
```typescript
// label-layout.ts:170-176
for (const s of states) {
    for (const a of s.actions) {
        g.setEdge(
            s.id,
            a.nextStateId,    // ← if not in `states`, dagre auto-creates a phantom node
            { label: a.id, action: a },
            a.id,
        );
    }
}

// label-layout.ts:181-183 — nodes built ONLY from `states`:
const nodes: NodePos[] = states.map((s) => {
    const n = g.node(s.id);
    return { id: s.id, x: n.x, y: n.y };
});
// phantom node created by dagre for undeclared a.nextStateId is NOT included here
```

```typescript
// render-html.ts:436 — layout.edges consumed:
var src = nodePos[e.srcId], tgt = nodePos[e.tgtId];
// If e.tgtId is a phantom → tgt === undefined → src.x/tgt.x → TypeError
```

#### Counterexample
FSM config where `$END` is referenced in an action but not declared as a state in the config file (a common pattern where terminal states are implicit):

```json
{
  "states": [{ "state_id": "A", "actions": [{ "action_id": "done", "next_state_id": "$END" }] }]
}
```

`$END` is not in `states` → dagre creates a phantom node for `$END` → `nodes` array lacks `$END` → `layout.edges` contains `{ srcId: "A", tgtId: "$END" }` → `nodePos["$END"]` is `undefined` at render time → `tgt.x` crashes the browser-side render loop.

#### Fix Direction
Before calling `dagre.layout(g)`, validate that every `a.nextStateId` referenced in actions exists in `states` (or add it as a virtual terminal node). Alternatively, filter `g.edges()` to exclude phantom-node edges before returning `layout.edges`.

---

### D3-006 — O(iterations × n²) Repulsion Loop — Quadratic Complexity on Large FSMs
**Severity**: LOW  
**File**: `visualizer/label-layout.ts:52–100`

#### Violated Performance Invariant
> **Performance invariant:** Label layout MUST complete in time proportional to the number of edges, not its square. FSMs with many transitions (e.g., 200+ actions) MUST not introduce noticeable blocking on the main thread of the Node process or browser.

#### The Code
```typescript
// label-layout.ts:52,59,64-65
function forceAvoid(labels: LabelBox[], iterations = 80): void {
    if (labels.length < 2) return;
    for (let iter = 0; iter < iterations; iter++) {     // 80 outer iters
        for (let i = 0; i < labels.length; i++) {
            for (let j = i + 1; j < labels.length; j++) {  // n*(n-1)/2 pairs
```

Total comparisons = `80 × n×(n-1)/2`.

#### Counterexample
| n (edge labels) | Overlap checks |
|---|---|
| 50 | ~98,000 |
| 200 | ~1,592,000 |
| 500 | ~9,975,000 |
| 1,000 | ~39,960,000 |

At 1,000 transitions (a large but plausible workflow FSM), `forceAvoid` performs ~40M floating-point comparisons synchronously in the Node process during `createVisualizerArtifact`. On a 2022 laptop this runs in ~400ms — blocking the MCP server's response thread for the full duration.

The loop is bounded (no infinite-loop risk), but complexity is unacceptable for large inputs.

#### Severity Rationale
Rated LOW rather than MEDIUM: typical FSMs have ≤100 states and the fixed 80-iteration cap prevents infinite loops. Becomes a genuine latency issue only above ~300 edges.

#### Fix Direction
Apply a spatial index (grid-based or quadtree bucketing) to reduce per-iteration cost to O(n log n). Alternatively, skip `forceAvoid` entirely if `labels.length > THRESHOLD` and fall back to the dagre midpoints directly.

---

### D3-007 — Silent Drop of Individual FSM Load Failures
**Severity**: LOW  
**File**: `visualizer/document.ts:40`

#### Violated Invariant
> **Observability invariant:** If the visualization is produced with fewer FSMs than the session stack contains, the caller (and user) MUST be informed which FSMs were omitted and why.

#### The Code
```typescript
// document.ts:35-54
for (const fsmId of fsmIds) {
    const runtime = loadRuntime(sessionDir, fsmId);
    if (!runtime) continue;   // ← silently skip, no log, no warning field in result
    fsms.push({ … });
}
if (fsms.length === 0)
    throw new Error("No readable steering-flow FSMs found in the active stack.");
```

#### Counterexample
A session with 4 stacked FSMs where FSM #2's state file is corrupted produces a visualization of FSMs #1, #3, #4. The returned `VisualizerArtifactResult.fsmCount` says `3`. No indication is given that FSM #2 was skipped. A developer debugging the session will see an incomplete diagram with no error — leading to incorrect conclusions about the FSM topology.

#### Fix Direction
Collect skipped FSM IDs and surface them either in the returned `VisualizerArtifactResult` (add a `skippedFsmIds: string[]` field) or as a warning written to `stderr`.

---

### D3-008 — Silent Early-Return in `renderFsm` Swallows Render Errors
**Severity**: LOW  
**File**: `visualizer/render-html.ts:407`

#### Violated Invariant
> **User-feedback invariant:** If a requested FSM cannot be rendered (fsm or layout missing), the HTML output MUST display a diagnostic message. Silently producing a blank visualization panel misleads the user.

#### The Code
```typescript
// render-html.ts:407 (inside `renderFsm` client-side function)
if (!fsm || !layout) return;
// No error text injected into the SVG or panel.
```

If `fsm` or `layout` is absent (e.g., `activeFsmId` points to an FSM that was silently skipped by D3-007, or a layout computation failed), the SVG container remains empty with no message.

#### Counterexample
Combined with D3-007: FSM #2 is dropped at the `document.ts` level; its ID is still referenced as `activeFsmId` from the session stack. `LAYOUTS[activeFsmId]` is `undefined`. `renderFsm(activeFsmId)` hits `if (!layout) return` silently. The user sees a blank diagram pane with no error — identical in appearance to a successful render of an FSM with no states.

#### Fix Direction
```typescript
if (!fsm || !layout) {
    root.append('text')
        .attr('x', 20).attr('y', 40)
        .text('FSM data unavailable for: ' + fsmId);
    return;
}
```

---

## Non-Findings (Explicitly Cleared)

| Area | Concern | Verdict |
|---|---|---|
| XSS from FSM state descriptions | State names / action IDs / descriptions injected into HTML | **CLEAR** — `escapeHtml()` applied server-side to `doc.title`; full document serialized with `safeJson()` (escapes `<`, U+2028, U+2029); all `innerHTML` assignments in client JS go through `esc()` which escapes `&<>"`. No user data reaches `innerHTML` unescaped. |
| XSS from `sourceLabel` / `filename` | Raw filename embedded in `VisualizerDocument.sourceLabel` | **CLEAR** — `sourceLabel` is set only via `.textContent` DOM assignment in the client (never `innerHTML`), and through `safeJson()` serialization server-side. |
| `getOutgoingLeveled` infinite loop | BFS over cyclic FSM graphs | **CLEAR** — `if (!(eKey in edgeLevel))` guard prevents re-visiting edges; BFS terminates in O(E) steps even for fully cyclic graphs. |
| `normalize-state.ts` semantic loss | `toVisualizerState` drops FSM fields | **CLEAR** — all semantically meaningful fields (`state_id`, `state_desc`, `is_epsilon`, `actions[]` with full `action_id`/`action_desc`/`next_state_id`/`arguments`/`condition`) are mapped. No loss. |
| `$START` / `$END` edge cases in `document.ts` | hardcoded `currentStateId: "$START"` for file mode | **CLEAR** — file mode has no runtime state; `$START` is a correct sentinel and is handled by `renderFsm`'s highlight logic. |
| Client `esc()` missing `'` | Single-quote not escaped | **CLEAR** — verified no user-derived data is placed in single-quoted HTML attribute values anywhere in `render-html.ts`. The gap is inert. |
| `drag-nodes.ts` | Inline script injection | **CLEAR** — `dragNodesCode` is a hardcoded string literal authored by the developer; it contains no user-supplied data and is injected as a static `<script>` block. |

---

## Severity Definitions

| Level | Meaning |
|---|---|
| CRITICAL | Exploitable remotely or via LLM prompt; direct filesystem compromise |
| HIGH | Violated documented contract / post-condition with concrete bad outcome |
| MEDIUM | Crash on valid input, or supply-chain risk with realistic attack path |
| LOW | Missing observability, degraded UX, or performance cliff under load |
