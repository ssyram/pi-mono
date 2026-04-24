# Batch 3 — Independent Audit Confirmation
**Reviewer**: Fresh reviewer (no prior audit context read)  
**Date**: 2026-04-24  
**Source base**: `/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/`  
**Method**: Direct source reading + grep. No audit documents consulted.

---

## D2-009 (HIGH) — `lastCompactionAt` is per-session, not per-FSM

**Verdict: CONFIRMED**

### Evidence

`index.ts` line 101:
```ts
const lastCompactionAt = new Map<string, number>();  // sessionId → ms
```

`index.ts` line 652 (compaction event handler):
```ts
pi.on("session_compact", async (_event, ctx) => {
    lastCompactionAt.set(ctx.sessionManager.getSessionId(), Date.now());
});
```

`index.ts` lines 673–675 (stop hook cooldown guard):
```ts
const lastCompact = lastCompactionAt.get(sessionId) ?? 0;
if (Date.now() - lastCompact < COMPACTION_GUARD_MS) return;
```

### Analysis

The map is keyed by `sessionId`. A session is a single Claude session, but multiple FSM instances (FSM-A, FSM-B) may be running within the same session concurrently. When FSM-A triggers a `session_compact` event, `lastCompactionAt` is updated for the shared `sessionId`. FSM-B's `agent_end` hook then reads the same key and finds the 60-second cooldown active — so its stop re-prompt is suppressed even though it had nothing to do with FSM-A's compaction.

The key used for both write (`session_compact`) and read (`agent_end`) is `getSessionId()` — identical in both cases. There is no per-FSM instance identifier in the key. The finding is accurate.

**Severity**: HIGH — Agreed. The suppression is silent and could cause legitimate stop-hook re-prompts to be dropped for up to 60 seconds in multi-FSM sessions.

---

## D2-010 (MEDIUM) — TOCTOU on compaction cooldown check

**Verdict: REJECTED (partially accurate premise, incorrect threat model)**

### Evidence

`index.ts` lines 673–675:
```ts
const lastCompact = lastCompactionAt.get(sessionId) ?? 0;
if (Date.now() - lastCompact < COMPACTION_GUARD_MS) return;
```

### Analysis

The audit claims a TOCTOU (Time-of-Check-Time-of-Use) race: between the `get` on line 674 and the use of the value on line 675, another async operation could modify the map entry.

In Node.js, JavaScript execution is single-threaded. An async operation can only interleave at an `await` point. There is **no `await`** between the `Map.get()` call and the conditional `return` — they are two consecutive synchronous statements. No other coroutine can modify `lastCompactionAt` between those two lines.

A true TOCTOU concern in this codebase would require either:
1. An `await` between check and use, or
2. Worker threads with shared memory (not used here).

The finding conflates the concept of async concurrency with CPU-level races. JavaScript `Map` operations are not subject to TOCTOU in single-threaded event-loop code with no interleaving `await`.

**The real concern** — which is distinct — is that the value *could have been set by another concurrent async chain* before the check, which is the D2-009 issue. D2-010 as a standalone TOCTOU claim does not hold.

**Severity**: MEDIUM overstated for the specific claim. A general "shared mutable state / stale read" framing would be valid; strict TOCTOU is not.

---

## D3-001 (CRITICAL) — Visualizer `outputFile` from LLM args, no path containment

**Verdict: CONFIRMED**

### Evidence

`index.ts` line 103–105 (`resolveFilePath`):
```ts
function resolveFilePath(cwd: string, p: string): string {
    return isAbsolute(p) ? p : resolve(cwd, p);
}
```

Tool schema (line 462):
```ts
output_file: Type.Optional(Type.String(...))
```
No pattern validation, no path constraints in the schema.

Tool handler (lines 470–473) passes directly:
```ts
outputFile: params.output_file
```

CLI handler (line 579–584):
```ts
outputFile = parts[i + 1]  // raw user/LLM arg, no validation
```

`visualizer/create-artifact.ts` line 12–16:
```ts
function resolveOutputPath(cwd: string, outputFile?: string): string {
    if (!outputFile || outputFile.trim().length === 0) {
        return resolve(cwd, ".pi", DEFAULT_ARTIFACT_NAME);
    }
    return isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
}
```

Then line 43:
```ts
await writeFile(outputPath, html, "utf8");
```

### Analysis

The path flows end-to-end without any containment check:

1. LLM calls the `visualizer_create` tool with arbitrary `output_file` value.
2. Schema validation does not constrain the string to any pattern.
3. `resolveOutputPath` in `create-artifact.ts` explicitly preserves absolute paths: `isAbsolute(outputFile) ? outputFile : ...`.
4. `writeFile` is called directly on the resolved path.

An LLM (or prompt-injected attacker) can provide `/etc/cron.d/malicious` or `~/.ssh/authorized_keys` and the code will write HTML content there, subject only to OS-level permissions. The finding is accurate.

**Severity**: CRITICAL — Agreed. This is an arbitrary file write from an LLM-controlled input.

---

## D3-002 (HIGH) — Post-condition: output file should be inside cwd; absolute paths bypass this

**Verdict: CONFIRMED**

### Evidence

`visualizer/create-artifact.ts` lines 12–16 (reproduced from D3-001):
```ts
return isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
```

There is **no assertion or check** anywhere in `create-artifact.ts`, `index.ts` tool handler, or CLI handler that verifies the resolved `outputPath` starts with `cwd`.

### Analysis

The intent expressed in the default path (`resolve(cwd, ".pi", DEFAULT_ARTIFACT_NAME)`) implies that artifacts should live under the working directory. However, this intent is never enforced as a post-condition or pre-condition:

- Absolute paths skip `resolve(cwd, ...)` entirely (`isAbsolute(outputFile) ? outputFile`).
- Relative paths with `../../../` traversal would also escape `cwd` after `resolve`.
- No `startsWith(cwd)` guard exists anywhere in the call chain.

This is a distinct finding from D3-001 — D3-001 identifies the injection vector; D3-002 identifies the missing invariant enforcement that would contain the damage even if a non-malicious absolute path is provided by a confused caller.

**Severity**: HIGH — Agreed. The missing containment check is an independent structural gap.

---

## D3-003 (MEDIUM) — `render-html.ts` loads d3.js from CDN without SRI hash

**Verdict: CONFIRMED**

### Evidence

`visualizer/render-html.ts` (CDN script tag in HTML template):
```html
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
```

No `integrity` attribute. No `crossorigin` attribute.

### Analysis

Subresource Integrity (SRI) requires an `integrity="sha384-..."` attribute on `<script>` tags loading from external origins. Without it:

1. If `cdn.jsdelivr.net` is compromised or the `d3@7` tag is hijacked, the browser will load and execute the malicious script with no verification.
2. The tag uses a floating version (`d3@7`) rather than a pinned version (`d3@7.9.0`), which increases the attack surface — a CDN-side update can silently change the content.
3. The `crossorigin` attribute is required for SRI to function; its absence means even if `integrity` were added, browsers would not enforce it correctly for cross-origin resources.

The finding is accurate. The correct mitigation is to pin an exact version, add an `integrity` hash, and add `crossorigin="anonymous"`.

**Severity**: MEDIUM — Agreed. The risk is indirect (CDN compromise required) but real and easily mitigated.

---

## Summary Table

| ID      | Severity | Verdict   | Notes |
|---------|----------|-----------|-------|
| D2-009  | HIGH     | ✅ CONFIRMED | `lastCompactionAt` keyed by `sessionId` only; all FSMs in same session share cooldown state |
| D2-010  | MEDIUM   | ❌ REJECTED | No `await` between check and use; TOCTOU does not apply to synchronous JS; general shared-state concern is real but mislabeled |
| D3-001  | CRITICAL | ✅ CONFIRMED | Arbitrary file write via LLM-controlled `output_file`; `resolveOutputPath` explicitly passes absolute paths through |
| D3-002  | HIGH     | ✅ CONFIRMED | No `startsWith(cwd)` containment check anywhere in the call chain; both absolute paths and `../` traversal escape intended boundary |
| D3-003  | MEDIUM   | ✅ CONFIRMED | CDN script tag missing `integrity` and `crossorigin`; floating `d3@7` version tag compounds risk |
