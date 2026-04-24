# D5 Hoare Audit — Resource Lifecycle (Migrated-Session Path Resolution)

**Plugin:** steering-flow  
**Dimension:** D5 — Resource Lifecycle  
**Auditor:** Sisyphus-Junior  
**Date:** 2026-04-23  
**Round:** 2

---

## Audit Scope

This audit focuses on the resource lifecycle of the steering-flow plugin, specifically:

1. Path resolution correctness for migrated sessions lacking `flow_dir` in persisted state.
2. FSM directory orphaning on `popFsm` rm failure.
3. Type-system accuracy of `FSMRuntime.flow_dir` given the migration reality.

Contracts are drawn from `docs/audit/Round2/spec-gate.md` (storage and engine contracts).  
**Note:** Issue #4 from the prior deferred list (`flow_dir ?? ""`) is reported here with its full analysis; the prior entry was a deferral placeholder, not an intentional omission.

---

## Findings

---

### D5-001 — Migrated Session: `flow_dir ?? ""` Causes Condition Scripts to Resolve Against Pi CWD, Not Flow Directory

**Severity:** HIGH  
**Status:** New (extends deferred Issue #4 from prior audit with full Hoare analysis)

#### Violated Contract

**Pre-condition** (runCondition, engine.ts): Before spawning a condition script, relative-path tokens (`./…`, `../…`) in `cmd` and `args` must be resolved against the directory of the original YAML file (`flow_dir`). The spawned command must be independent of the process working directory.

**Invariant** (FSMRuntime): `flow_dir` must equal the absolute path of the directory containing the YAML that defined the FSM, for the entire lifetime of the session. It is not permitted to be the empty string for any session backed by a real file.

#### Root Cause Chain

1. **`storage.ts:261`** — `loadRuntime` deserialises `fsm.json` from disk. For sessions persisted before `flow_dir` was added to the schema, `struct.flow_dir` is `undefined` at runtime. The recovery expression is:

   ```ts
   flow_dir: struct.flow_dir ?? "",  // backward-compat: older on-disk records may lack it
   ```

   This substitutes the empty string `""` for the missing field and returns an `FSMRuntime` with `flow_dir = ""`.

2. **`engine.ts:23`** — `resolveTokenRelToFlow` checks `!flowDir` as its guard:

   ```ts
   function resolveTokenRelToFlow(token: string, flowDir: string): string {
       if (!flowDir) return token;           // "" is falsy → early return
       if (token.startsWith("./") || token.startsWith("../")) {
           return pathResolve(flowDir, token);
       }
       return token;
   }
   ```

   `""` is falsy in JavaScript. The function **short-circuits and returns the token unchanged** instead of resolving it. A relative token such as `./check-budget.mjs` is passed directly to `spawn`.

3. **`engine.ts:75`** — Both `cmd` and each element of `args` pass through `resolveTokenRelToFlow`:

   ```ts
   const cmd = resolveTokenRelToFlow(interpolatePlaceholders(rawCmd, tapePath, namedArgs), flowDir);
   const configArgs = rawConfigArgs.map((a) =>
       resolveTokenRelToFlow(interpolatePlaceholders(a, tapePath, namedArgs), flowDir),
   );
   ```

4. **`engine.ts:84`** — `spawn` is called with the unresolved relative path and the `cwd` parameter set to `ctx.sessionManager.getCwd()` (the process working directory at call time, **not** the flow directory):

   ```ts
   child = spawn(cmd, argv, { cwd, ... });
   ```

   Node's `child_process.spawn` resolves a relative executable path against the `cwd` option. If pi's CWD differs from the original flow directory (e.g., the user `cd`-ed between sessions, or pi was restarted from a different directory), `spawn` raises **ENOENT**.

5. **`engine.ts:245` and `engine.ts:330`** — Both `executeAction` and `chainEpsilon` pass `runtime.flow_dir` to `runCondition`, so **every condition-bearing action and every epsilon-chain transition** is affected.

#### Concrete Counterexample

**Setup:**
- Flow YAML located at `/projects/budget/flow.yaml`.
- Condition: `{ cmd: "./check-budget.mjs" }`.
- Session created while pi's CWD was `/projects/budget`.
- `flow_dir` was not yet in the schema when the session was saved → `fsm.json` contains no `flow_dir` field.

**Resumption:**
- User resumes session from `/home/user` (pi CWD changed).
- `loadRuntime` → `flow_dir = ""`.
- `resolveTokenRelToFlow("./check-budget.mjs", "")` → `"./check-budget.mjs"` (unchanged).
- `spawn("./check-budget.mjs", [], { cwd: "/home/user" })`.
- OS looks for `/home/user/check-budget.mjs` → **ENOENT**.
- Condition throws; the FSM transition fails.

**Expected behaviour (non-migrated session):**
- `flow_dir = "/projects/budget"`.
- `resolveTokenRelToFlow("./check-budget.mjs", "/projects/budget")` → `"/projects/budget/check-budget.mjs"`.
- `spawn("/projects/budget/check-budget.mjs", [], { cwd: ... })` → succeeds regardless of CWD.

#### Affected Files and Lines

| File | Line | Role |
|---|---|---|
| `storage.ts` | 261 | Migration fallback: `struct.flow_dir ?? ""` |
| `engine.ts` | 23 | Guard `!flowDir` short-circuits on `""` |
| `engine.ts` | 75–77 | `resolveTokenRelToFlow` called for cmd and every arg |
| `engine.ts` | 84 | `spawn(cmd, argv, { cwd })` — cwd ≠ flow dir |
| `engine.ts` | 245 | `executeAction` passes `runtime.flow_dir` |
| `engine.ts` | 330 | `chainEpsilon` passes `runtime.flow_dir` |

#### Remediation Direction

Replace the silent `?? ""` fallback with a reconstruction of `flow_dir` from the persisted `flow_name` and `flow_dir` stored in `FsmStructure.flow_dir` (already written for all new sessions in `storage.ts:195`). For truly old records where `flow_dir` is absent from `FsmStructure`, surface an explicit error rather than silently degrading to a CWD-relative lookup. Alternatively, store `flow_dir` in `FsmStructure` (which already has it at `storage.ts:169`) and copy it unconditionally during `loadRuntime`.

---

### D5-002 — Orphaned FSM Directory After `popFsm` rm Failure: No Recovery Path

**Severity:** MEDIUM  
**Status:** New

#### Violated Contract

**Post-condition** (popFsm / loadAndPush rollback, per spec-gate.md storage contracts): After `popFsm` completes, the popped FSM's directory must no longer exist on disk **and** must not appear in the stack. Persistent orphan directories are not permitted to accumulate across sessions.

**Invariant** (session directory): The set of FSM directories on disk must be a subset of the FSM IDs in the current stack. Any FSM directory not referenced by the stack is an unreachable orphan.

#### Root Cause Chain

`popFsm` in `storage.ts:111-124`:

```ts
export async function popFsm(sessionDir: string): Promise<string | undefined> {
    const stack = await readStack(sessionDir);
    const top = stack.pop();
    await writeStack(sessionDir, stack);      // stack committed to disk — top is now gone
    if (top) {
        try {
            await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });
        } catch {
            // Leave orphan on rm error; not fatal   ← storage.ts:120
        }
    }
    return top;
}
```

The sequence is:
1. `stack.pop()` removes `top` from the in-memory array.
2. `writeStack(sessionDir, stack)` **atomically commits** the updated (shorter) stack to disk.
3. Only then is `fs.rm` attempted for the FSM directory.

If step 3 fails (permissions error, directory locked by another process, OS-level issue):
- The stack no longer references the FSM ID.
- No future code path will attempt to clean up that specific directory.
- `sweepTmpFiles` only sweeps `.tmp` files and does not remove whole FSM subdirectories.
- There is no deferred-cleanup registry or periodic GC hook.

**Callers of `popFsm` — all affected identically:**

| Site | File | Line | Trigger |
|---|---|---|---|
| Normal user pop | `index.ts` | 338 | `/pop-steering-flow` command |
| Rollback on `enterStart` throw | `index.ts` | 180 | Error during initial epsilon chain |
| Rollback on epsilon chain failure | `index.ts` | 190 | `entry.success === false` |
| Rollback on immediate `$END` reached | `index.ts` | 200 | Flow completes immediately on load |
| Action `reached_end` cleanup | `index.ts` | 250 | FSM reaches `$END` during action |

#### Concrete Counterexample

**Scenario 1 — Permissions race:**
- User loads flow A, which pushes `fsmDir/abc123/`.
- User pops flow A via `/pop-steering-flow`.
- A background process (e.g., antivirus scanner) has `abc123/` open; `fs.rm` returns `EBUSY`.
- Stack is now `[]`; `abc123/` still exists on disk.
- The user reloads the same flow: a **new** `fsmId` is generated → `abc123/` accumulates permanently.

**Scenario 2 — Rollback orphan on load failure:**
- User loads flow B; `writeFsmStructure` succeeds, `pushFsm` succeeds → stack: `[..., defgh456]`.
- `enterStart` (epsilon chain from `$START`) throws an unexpected error.
- `popFsm` is called (rollback): stack written as `[...]`, then `fs.rm(fsmDir/defgh456)` fails.
- `defgh456/` is now an unreachable orphan in the session directory.
- The error path returns `{ ok: false, ... }` to the caller with no indication that the directory was not cleaned.

**Post-condition violated:** `popFsm` returned, stack no longer references `defgh456`, but `defgh456/` is still on disk. The invariant "directories on disk ⊆ IDs in stack" is broken.

#### Affected Files and Lines

| File | Line | Role |
|---|---|---|
| `storage.ts` | 111–124 | `popFsm` — commits stack before rm, swallows rm error |
| `storage.ts` | 119 | `fs.rm(fsmDir(...), { recursive: true, force: true })` |
| `storage.ts` | 120 | `catch { /* Leave orphan on rm error; not fatal */ }` |
| `index.ts` | 180 | Rollback call #1 (enterStart throw) |
| `index.ts` | 190 | Rollback call #2 (epsilon chain failure) |
| `index.ts` | 200 | Rollback call #3 (immediate $END) |
| `index.ts` | 250 | Normal pop on reached_end |
| `index.ts` | 338 | User-driven pop |

#### Remediation Direction

Two complementary mitigations:
1. **Reorder** the rm attempt before `writeStack`, so a failed rm leaves the stack intact. The caller can then retry. (Trade-off: if rm succeeds but writeStack fails, the directory is gone but still in the stack — caller must handle this case too.)
2. **Orphan sweep in `session_start`**: extend `sweepTmpFiles` (or add a separate hook) to enumerate FSM subdirectories and remove any whose FSM ID does not appear in the stack. This provides a bound on orphan accumulation.

---

### D5-003 — `FSMRuntime.flow_dir` Typed as Non-Optional `string` but Deserialises as `undefined` for Migrated Sessions

**Severity:** LOW  
**Status:** New

#### Violated Contract

**Type-correctness invariant**: The TypeScript type of `FSMRuntime.flow_dir` at `types.ts:50` is `string` (non-optional). This declaration asserts that any `FSMRuntime` value in the program will always carry a valid string in that field. However, for sessions loaded from on-disk records written before `flow_dir` was part of the schema, `struct.flow_dir` is `undefined` at the JavaScript level, violating this declared type before the `?? ""` patch is applied.

The type declaration is therefore a **false invariant**: it promises a property the runtime cannot guarantee for migrated sessions, masking the migration gap from the type-checker. Any code that relies on `runtime.flow_dir` being a non-empty string will not receive a type-level warning.

#### Concrete Counterexample

```ts
// types.ts:50
export interface FSMRuntime {
    flow_dir: string;   // declared non-optional
    ...
}

// storage.ts:261 — at runtime, struct is typed as FsmStructure (flow_dir: string)
// but the on-disk JSON may lack the field entirely.
// JSON.parse produces { ..., flow_dir: undefined } for old records.
// TypeScript cannot see this — the type lie propagates silently.
flow_dir: struct.flow_dir ?? "",
```

A caller that checks `if (runtime.flow_dir)` to distinguish "has a real path" from "migration fallback" is forced to use runtime truthiness instead of the type system, undermining the purpose of the type annotation.

#### Affected Files and Lines

| File | Line | Role |
|---|---|---|
| `types.ts` | 50 | `flow_dir: string` — should be `string \| undefined` or validated at boundary |
| `storage.ts` | 261 | `struct.flow_dir ?? ""` — silences the `undefined` before it reaches callers |

#### Remediation Direction

Either:
- Change `types.ts` to `flow_dir: string | undefined` and update all callers to handle `undefined` explicitly (correct representation of reality).
- Or perform migration at the persistence boundary: when `struct.flow_dir` is absent, attempt reconstruction from `flow_name` (if the original path can be inferred) or throw a `CorruptedStateError` rather than substituting `""`.

---

## Summary Table

| Finding ID | Severity | Description | Primary File:Line |
|---|---|---|---|
| D5-001 | HIGH | Migrated session `flow_dir=""` → relative condition scripts resolve against Pi CWD; breaks on CWD change between sessions | `storage.ts:261`, `engine.ts:23` |
| D5-002 | MEDIUM | `popFsm` commits stack before rm; rm failure leaves unreachable orphan FSM dirs with no recovery path | `storage.ts:111-124` |
| D5-003 | LOW | `FSMRuntime.flow_dir` typed as `string` (non-optional) but deserialises as `undefined` for old records; type is a false invariant | `types.ts:50` |

---

## Non-Findings (Investigated, No Violation)

| Question | Conclusion |
|---|---|
| `sweepTmpFiles` coverage gap in non-`session_start` hooks | Spec explicitly limits sweep to `session_start`. `sweepTmpFiles` covers all `atomicWriteJson` call sites (max one level of nesting). No new finding. |
| URL/stdin as YAML source — `flow_dir` undefined | Feature does not exist; `loadAndPush` accepts only local file paths (`stat` + `readFile`). Not applicable. |
| `cwd` vs `flow_dir` confusion in `executeAction` | `cwd` (spawn working directory) and `flow_dir` (token base) are separate by design; no confusion in new sessions. Only migrated sessions are affected (covered by D5-001). |
