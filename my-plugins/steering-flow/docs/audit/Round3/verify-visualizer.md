# Round 3 Verification — Visualizer Fixes

Date: 2026-04-24  
Files examined: `visualizer/create-artifact.ts`, `visualizer/label-layout.ts`

---

## RC-C — Path Containment (create-artifact.ts)

### What was checked

`resolveOutputPath` and the `flowFile` path guard both use:

```ts
resolved.startsWith(cwd + sep) && resolved !== cwd
```

**Mental-model test:**
- Input: `path.resolve('/cwd', '../../etc/passwd')` → `/etc/passwd`
- `/etc/passwd`.startsWith(`/cwd/`) → `false` → throws ✓

**`cwd + sep` vs bare `cwd`:**
- Prevents false-positive prefix match: `/cwdother/file` does NOT start with `/cwd/` → correctly rejected ✓

**Absolute input path:**
- `path.resolve(cwd, '/abs/path')` returns `/abs/path` (Node behaviour)
- `/abs/path`.startsWith(`/cwd/`) → `false` → rejected ✓

**`../` traversal:**
- Any `../` that escapes `cwd` resolves to a path that fails the `startsWith` check → rejected ✓

**Edge case — path equal to cwd:**
- `resolved !== cwd` guard prevents accepting the bare `cwd` itself as a valid output location ✓

### Verdict

**PASS** — Containment logic is correct. All traversal and absolute-path escape vectors are blocked.

---

## D3-005 — Edge skip for missing states (label-layout.ts)

### What was checked

Inside the edge-setting loop the fix:

1. Builds a `stateIds` Set from the full `states` array before the loop.
2. Guards every `g.setEdge(...)` call with:

```ts
if (!stateIds.has(a.nextStateId)) continue;
```

**Missing target state:** edge is silently skipped — no crash, no undefined node access ✓  
**`nodeMap` safety:** `nodeMap` is built from `states` only; a missing `nextStateId` never reaches a `nodeMap` lookup ✓  
**No regression introduced:** `forceAvoid`, `estimateBox`, `overlaps`, and arc-length label logic are pure functions with no dependency on state existence ✓

### Verdict

**PASS** — Edges to missing states are skipped without crash. No regressions detected.

---

## Summary

| ID     | Fix Location                  | Status |
|--------|-------------------------------|--------|
| RC-C   | `visualizer/create-artifact.ts` — `resolveOutputPath` + flowFile guard | **PASS** |
| D3-005 | `visualizer/label-layout.ts` — `stateIds.has()` guard in edge loop     | **PASS** |
