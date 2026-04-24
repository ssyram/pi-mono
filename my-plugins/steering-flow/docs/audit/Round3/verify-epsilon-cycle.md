# Verification: Epsilon Cycle Detection in buildFSM

**Verdict: PASS**

**File:** `my-plugins/steering-flow/parser.ts`
**Location:** buildFSM function, after dead-end check (~line 337)

## Criteria Checklist

### 1. Present after dead-end check — PASS
The epsilon-cycle detection block begins immediately after the `if (deadEnds.length > 0)` throw block, preceded by a comment `// Epsilon-cycle detection: DFS on the epsilon-only subgraph.`

### 2. Correct 3-color DFS (white/gray/black) — PASS
- WHITE: node not present in `color` map (`!color.has(id)`)
- GRAY: `const GRAY = 1` — set on DFS entry, indicates node is in the current exploration path
- BLACK: `const BLACK = 2` — set after all descendants are fully explored

### 3. Only epsilon states traversed as cycle participants — PASS
`epsilonDFS` checks `if (!st || !st.is_epsilon)` early. Non-epsilon states are immediately colored BLACK and the function returns — they never recurse into neighbors and cannot participate in a detected cycle.

### 4. Error message includes cycle path — PASS
Cycle path is constructed via `path.indexOf(next)` to locate the cycle start, then `path.slice(cycleStart).concat(next)` to extract the loop. Thrown as `ParseError` with message:
```
Epsilon cycle detected: ${cycle.join(" → ")}. Epsilon states must not form cycles — the engine would loop without progress.
```

### 5. Runs on all forward-reachable states — PASS
Launch loop iterates `fwdVisited` (the set populated by the earlier forward BFS from `$START`):
```ts
for (const id of fwdVisited) {
  if (!color.has(id)) epsilonDFS(id, [id]);
}
```
Every forward-reachable state is considered as a potential DFS root.

### 6. Non-epsilon states terminate DFS branch — PASS
Non-epsilon states (and missing states) hit the `if (!st || !st.is_epsilon)` guard, are colored BLACK immediately, and return without recursing. They act as DFS terminators, not cycle participants.

## Summary

The implementation is a correct DFS-based cycle detector scoped to the epsilon-only subgraph. It runs at the right point in the pipeline (after BFS reachability, after dead-end pruning), uses standard 3-color marking to detect back-edges, and produces a clear error with the full cycle path. No issues found.
