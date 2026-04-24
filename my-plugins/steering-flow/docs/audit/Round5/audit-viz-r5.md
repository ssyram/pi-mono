# Round 5 Regression Audit — `visualizer/create-artifact.ts`

**Scope**: Verify R4-V-002 fix correctness; check for regressions introduced by the change.  
**Date**: 2026-04-24  
**Auditor**: Sisyphus-Junior (automated)

---

## R4-V-002 Fix Verification

The fix normalizes `cwd` via `path.resolve()` before the `startsWith` containment check, and appends `sep` to prevent the `/foo/bar` vs `/foo/barbaz` prefix collision.

### Platform / edge-case checklist

| Case | Input | `resolve()` result | `normalizedCwd` | Passes check? | Correct? |
|---|---|---|---|---|---|
| Trailing slash cwd | `cwd="/foo/bar/"`, `outputFile="out.html"` | `/foo/bar/out.html` | `/foo/bar` | ✓ starts with `/foo/bar/` | ✅ |
| Relative cwd | `cwd="rel"`, `outputFile="out.html"` | `<process.cwd()>/rel/out.html` | `<process.cwd()>/rel` | ✓ | ✅ |
| Empty-string cwd | `cwd=""`, `outputFile="out.html"` | `<process.cwd()>/out.html` | `<process.cwd()>` | ✓ | ✅ |
| Escape via relative path | `cwd="/foo/bar"`, `outputFile="../../etc/passwd"` | `/etc/passwd` | `/foo/bar` | ✗ blocked | ✅ |
| Prefix collision | `cwd="/foo/bar"`, `outputFile="../barbaz/x"` | `/foo/barbaz/x` | `/foo/bar` | ✗ blocked (sep suffix) | ✅ |
| outputFile equals cwd | `cwd="/foo/bar"`, `outputFile="."` | `/foo/bar` | `/foo/bar` | allowed (`resolved === normalizedCwd`) | ⚠️ see R5-V-002 |

**Conclusion**: The R4-V-002 fix is correct for all tested cases on both POSIX and Windows (`sep` is platform-aware). Both the `outputFile` check (line 17) and the `flowFile` check (line 35) use `resolve(options.cwd)` — normalization is applied consistently.

---

## Findings

### R5-V-001 — Absolute path with `..` segments bypasses containment check

**Severity**: HIGH  
**Violated invariant**: Post-condition — resolved output path must be strictly contained within `cwd`.

**Location**: line 15 (outputFile), line 33 (flowFile)

**Root cause**: The absolute-path branch uses the raw value without calling `resolve()`:

```ts
// line 15 — current code
const resolved = isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
```

When `outputFile` is absolute, `resolve()` is skipped. The value is used as-is, so `..` segments are never normalized.

**Counterexample**:
```
cwd        = "/foo/bar"
outputFile = "/foo/bar/../../etc/passwd"

resolved      = "/foo/bar/../../etc/passwd"   // raw, not normalized
normalizedCwd = "/foo/bar"

resolved.startsWith("/foo/bar/")  →  true   // check PASSES
OS path       = /etc/passwd                 // file written outside cwd
```

The same exploit applies to `flowFile` (line 33) with an identical code pattern.

**Fix**: Remove the conditional — `resolve()` handles absolute paths correctly (an absolute second argument overrides the first, and `..` segments are normalized):

```ts
// line 15 — proposed fix
const resolved = resolve(cwd, outputFile);

// line 33 — proposed fix
const absFlow = resolve(options.cwd, options.flowFile);
```

---

### R5-V-002 — `outputFile = "."` is silently allowed; causes runtime `EISDIR`

**Severity**: LOW  
**Violated invariant**: Pre-condition — `outputFile` should resolve to a regular file path, not the `cwd` directory itself.

**Location**: line 17 containment check (`resolved !== normalizedCwd` branch)

**Root cause**: The check explicitly permits `resolved === normalizedCwd` to allow the cwd directory as a valid output path. This is almost certainly unintentional.

**Counterexample**:
```
cwd        = "/foo/bar"
outputFile = "."

resolved      = "/foo/bar"
normalizedCwd = "/foo/bar"

resolved !== normalizedCwd  →  false  // check passes
fs.writeFile("/foo/bar", ...)  →  throws EISDIR at runtime
```

No security impact. The error surfaces downstream at the `writeFile` call rather than at the validation boundary, making the failure mode less clear.

**Fix**: Remove the `resolved !== normalizedCwd` escape hatch, or add an explicit directory check before the containment guard.

---

## Summary

| ID | Severity | Description | Status |
|---|---|---|---|
| R4-V-002 | — | cwd normalization fix | ✅ Correct |
| R5-V-001 | HIGH | Absolute path with `..` bypasses containment | 🔴 New finding |
| R5-V-002 | LOW | `outputFile="."` allowed; runtime EISDIR | 🟡 New finding |
