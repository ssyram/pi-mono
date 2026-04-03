# Code Quality Scan Report — `manage-extensions`

**Date:** 2026-04-02
**Scope:** Code quality (architecture, LOC limits, naming, duplication, imports, types, keybindings, index.ts compliance, dead code)

---

## 1. Methodology Application

The scan follows the four-phase finegrained-check methodology:

1. **Scope determination** — Code quality: architecture, LOC limits, naming, imports, types, keybindings, SRP, dead code.
2. **Proposition extraction** — Each enforceable rule from AGENTS.md was turned into a testable proposition (P1–P8 below).
3. **Contradiction/omission check** — Each file was read in full; evidence collected via grep for exact line numbers before any conclusion was drawn.
4. **Design-point cross-coverage matrix** — Six files × eight rules checked pairwise; all 48 cells evaluated.

### Propositions

| ID | Proposition | Source |
|----|-------------|--------|
| P1 | No `any` types unless absolutely necessary | AGENTS.md |
| P2 | No inline imports | AGENTS.md |
| P3 | All key checks configurable — no hardcoded key literals | AGENTS.md |
| P4 | `index.ts` contains only re-exports, no business logic | AGENTS.md (implied by module rules) |
| P5 | No file exceeds 200 LOC (excluding blank lines and single-line comments) | AGENTS.md |
| P6 | Single Responsibility Principle — one concept per file | AGENTS.md |
| P7 | No dead code (unused imports, variables, functions) | Code quality standard |
| P8 | Types are precise — no overly broad types where narrow ones apply | Code quality standard |

---

## 2. Issues Found

### Issue 1 — `extension-list.ts` exceeds 200 LOC hard limit

**Severity:** Critical  
**File:** `my-plugins/manage-extensions/extension-list.ts`  
**Rule violated:** P5

**Evidence:**

```
Total lines:   360
Blank lines:    32
Comment lines:   4
Code lines:    324   ← hard limit is 200
```

The file is 62% over the enforced limit. This is a direct, measured violation.

---

### Issue 2 — `extension-list.ts` SRP violation: multiple unrelated concepts in one file

**Severity:** Critical (co-causes Issue 1)  
**File:** `my-plugins/manage-extensions/extension-list.ts`  
**Rule violated:** P6

**Evidence — distinct concepts present in one file:**

| Concept | Lines (approx.) |
|---------|----------------|
| Type definitions (`Pending`, `Focus`, `ActionId`, `ListResult`, `KeyMap`) | 1–20 |
| Key map factory (`createKeyMap`) | 35–48 |
| State accessors (`getState`, `toggleField`) | 50–70 |
| Full TUI component factory (`buildListComponent`) with ~180 lines of render + input logic | 65–320 |
| Standalone render helper (`renderScopeToken`) | ~322–335 |
| Search utilities (`searchableText`, `normalizeSearch`, `matchesSearch`) | ~336–360 |

The search utilities and `renderScopeToken` are self-contained, reusable functions with no dependency on each other or the component's closure. `createKeyMap` is a configuration object. Bundling all six into one file is the direct cause of the LOC overrun.

---

### Issue 3 — Hardcoded key literals in `createKeyMap` (4 bindings + 1 partial)

**Severity:** Critical  
**File:** `my-plugins/manage-extensions/extension-list.ts`, lines 37–44  
**Rule violated:** P3

**Evidence:**

```typescript
// Line 37 — confirm uses kb.matches() but appends raw char literals as fallback
confirm: (data) => kb.matches(data, "tui.select.confirm") || data === "\r" || data === "\n",

// Line 40 — not routed through keybinding system at all
left: (data) => matchesKey(data, "left"),

// Line 41 — not routed through keybinding system at all
right: (data) => matchesKey(data, "right"),

// Line 43 — not routed through keybinding system at all
shiftTab: (data) => matchesKey(data, "shift+tab"),

// Line 44 — raw character comparison
space: (data) => data === " ",
```

`matchesKey(data, "left")` etc. checks a fixed string at call time; it is not looked up from a configurable keybindings object. `data === " "` and the `"\r"` / `"\n"` literals are direct raw-character checks. None of `left`, `right`, `shiftTab`, or `space` are registered in the keybinding system, making them impossible to remap by configuration. The `confirm` binding mixes a configurable path with hardcoded fallbacks, meaning the fallback behaviour can never be disabled or remapped.

---

### Issue 4 — `index.ts` contains business logic (not re-exports only)

**Severity:** Major  
**File:** `my-plugins/manage-extensions/index.ts`, lines 121–168  
**Rule violated:** P4

**Evidence:**

```
Line 25:  export default function (pi: ExtensionAPI) { ... }   ← ~96 lines of command handler logic
Line 121: function buildChanges(...): ChangeEntry[] { ... }    ← private business-logic helper
Line 135: function buildScanProgressComponent(...): Component  ← private UI factory
```

`buildChanges` builds a diff between `ExtensionState[]` and pending changes. `buildScanProgressComponent` constructs a live TUI component that polls `getCurrentProgress()`. Neither is exported; both are substantial domain functions (14 and 34 lines respectively). The file's purpose as `index.ts` should be to compose and re-export; both helpers belong in dedicated files (e.g., `build-changes.ts` or inside `apply-changes.ts`, and the progress component inside a `scan-progress.ts`).

---

### Issue 5 — `applyOne` uses `scope: string` instead of `"local" | "global"`

**Severity:** Minor  
**File:** `my-plugins/manage-extensions/apply-changes.ts`, line 136  
**Rule violated:** P8

**Evidence:**

```typescript
// Line 58 — collectPreflightIssues uses the precise union type:
function collectPreflightIssues(ext: DiscoveredExtension, change: ..., scope: "local" | "global"): ...

// Line 136 — applyOne uses a broad string:
function applyOne(ext: DiscoveredExtension, change: ..., dir: string, scope: string, ...): void
```

Both functions are private (not exported). The callers at lines 50–51 pass the string literals `"local"` and `"global"` directly:

```typescript
applyOne(extension, local, projectExtDir, "local", applied, warnings);
applyOne(extension, global, globalExtDir, "global", applied, warnings);
```

Using `scope: string` in `applyOne` means TypeScript cannot catch a typo at the call site. Narrowing to `"local" | "global"` would be consistent with `collectPreflightIssues` and adds free correctness.

---

## 3. Design-Point Cross-Coverage Matrix

| File | P1 `any` | P2 inline imports | P3 key literals | P4 index re-exports | P5 LOC ≤200 | P6 SRP | P7 dead code | P8 precise types |
|------|----------|-------------------|-----------------|---------------------|-------------|--------|--------------|-----------------|
| `index.ts` | ✅ | ✅ | ✅ | ❌ Issue 4 | ✅ (151) | ⚠ (minor, caused by P4) | ✅ | ✅ |
| `extension-list.ts` | ✅ | ✅ | ❌ Issue 3 | n/a | ❌ Issue 1 | ❌ Issue 2 | ✅ | ✅ |
| `apply-changes.ts` | ✅ | ✅ | ✅ | n/a | ✅ (152) | ✅ | ✅ | ❌ Issue 5 |
| `resolve-state.ts` | ✅ | ✅ | ✅ | n/a | ✅ (34) | ✅ | ✅ | ✅ |
| `discover-extensions.ts` | ✅ | ✅ | ✅ | n/a | ✅ (138) | ✅ | ✅ | ✅ |
| `scan-cache.ts` | ✅ | ✅ | ✅ | n/a | ✅ (100) | ✅ | ✅ | ✅ |

Legend: ✅ pass, ❌ fail (issue filed), ⚠ concern

---

## 4. Overall Assessment

The module has a healthy core: `resolve-state.ts`, `discover-extensions.ts`, `scan-cache.ts`, and `apply-changes.ts` are well-structured, clean, and within all limits. Three of the six files are fully compliant.

The problems are concentrated in two files and are related:

- **`extension-list.ts`** carries three simultaneous violations (LOC, SRP, hardcoded keybindings). The LOC overrun (324 vs 200) is a direct consequence of the SRP violation — six distinct concepts are packed into one file. Splitting the search utilities, the key-map factory, and the render helper into separate files would resolve both Issues 1 and 2 simultaneously, and make the remaining hardcoded keybindings (Issue 3) easier to address in isolation.

- **`index.ts`** violates the re-exports-only rule by housing two private business-logic functions (`buildChanges`, `buildScanProgressComponent`). These should move to appropriate files (`apply-changes.ts` or a new `build-changes.ts`, and a new `scan-progress.ts` component file).

- **`apply-changes.ts`** has one minor type precision issue (Issue 5) requiring a one-word fix.

**Critical issues: 3** (Issues 1, 2, 3)  
**Major issues: 1** (Issue 4)  
**Minor issues: 1** (Issue 5)
