# Round 8 Audit — Nits

> Low-signal findings that require no immediate action.
> All classified NIT or GUARDED with no fix required.

---

## R8-I-003 — Second `loadRuntime` error silently swallowed in `infoCall`
**Module:** index.ts | **Severity:** Low

The second `loadRuntime` call in `infoCall` has a catch block commented "already surfaced above" — but it is a separate call for the top FSM. Errors are silently dropped. Logging gap only; no data corruption or security impact.

**Suggested improvement:** Log at `warn` level or include in the return object. Not worth a dedicated fix pass.

---

## R8-E-005 — Off-by-one in `chainEpsilon` depth cap
**Module:** engine.ts | **Severity:** Low

`while (depth < MAX_EPSILON_DEPTH)` caps at 63 iterations, not 64 as `MAX_EPSILON_DEPTH` implies. One fewer epsilon hop than documented. No practical impact — chains of 63 vs 64 are both far beyond any real flow.

**Suggested improvement:** Change to `while (depth <= MAX_EPSILON_DEPTH)` or rename constant to `MAX_EPSILON_DEPTH_MINUS_ONE`. Either is fine.

---

## R8-E-006 — `enterStart` silently succeeds on already-advanced runtime
**Module:** engine.ts | **Severity:** Low

`enterStart` does not assert the runtime is at `$START` before proceeding. Calling it on an already-advanced runtime silently no-ops or corrupts state. Callers currently control this correctly.

**Suggested improvement:** Add `if (runtime.currentState !== "$START") throw new Error(...)` as a defensive assertion. Low urgency.

---

## R8-V-005 — `estimateBox` uses fixed `textLength * 7` — wrong for non-ASCII
**Module:** label-layout.ts | **Severity:** Low

Label box width estimated as `textLength * 7`. Incorrect for CJK (typically ~14px/char), emoji, and other wide glyphs. Causes label overlap in non-ASCII diagrams.

**Suggested improvement:** Use `Intl.Segmenter` or a simple heuristic (`/[\u4e00-\u9fff]/` → 14px, else 7px) to approximate glyph width. Only matters if non-ASCII state/transition names are used.

---

## R8-SP-005 — Negligible TOCTOU window in `atomicWriteJson`
**Module:** storage.ts | **Severity:** Low

Tiny race window between temp-file write and rename. In a single-process, lock-held context this is not exploitable. Rename-based atomic write is the correct pattern.

**Disposition:** No action. The implementation is correct for the deployment model.

---

## R8-V-006 — Raw `dragNodesCode` interpolated into `<script>` block (latent)
**Module:** render-html.ts:150 | **Severity:** Low (latent) | **Classification:** GUARDED

`dragNodesCode` is interpolated directly into a `<script>` block without escaping. Currently safe because `dragNodesCode` is a static internal string. All user-facing values correctly use `esc`/`escapeHtml`/`safeJson`.

**Watch condition:** If `dragNodesCode` ever becomes dynamic or user-influenced, this becomes stored XSS. Add a note to any future PR that touches this variable.
