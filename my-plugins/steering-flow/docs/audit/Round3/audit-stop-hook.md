# D2 — Stop Hook Correctness Audit

**Scope:** `agent_end` stop hook and all helpers it invokes.
**Files examined:** `index.ts`, `stop-guards.ts`, `storage.ts`, `engine.ts`, `README.md`
**Auditor:** Sisyphus-Junior / Hoare-audit pass
**Date:** 2026-04-24

---

## Summary

| ID | Area | Severity |
|----|------|----------|
| D2-001 | `isAskingQuestion` — trailing-`?` false positive: optional chaining | High |
| D2-002 | `isAskingQuestion` — trailing-`?` false positive: URLs / query strings | Medium |
| D2-003 | `isAskingQuestion` — trailing-`?` false positive: code block last line | Medium |
| D2-004 | `CONFIRM_STOP_TAG` — `includes()` fires on tag inside code fence | High |
| D2-005 | `stableStringify` — `undefined` and `null` produce identical hashes | Medium |
| D2-006 | `stableStringify` — `Date` objects hash as `{}` regardless of value | Low |
| D2-007 | `stableStringify` — no circular-reference guard (stack overflow) | Low |
| D2-008 | Stagnation counter comment misleads: writes `nextCount`, not `0` | Low |
| D2-009 | Compaction cooldown is per-session, not per-FSM (cross-FSM bleed) | High |
| D2-010 | Guard order: compaction check runs outside the mutex (TOCTOU) | Medium |
| D2-011 | `ctx.signal?.aborted` — optional chaining masks missing signal | Low |

---

## Findings

---

### D2-001 — `isAskingQuestion`: optional chaining (`?.`) triggers false positive

**Violated:** Post-condition of the guard  
> *"Returns `true` iff the assistant genuinely ended its turn with a question directed at the user."*

**Location:** `stop-guards.ts:37` (`text.trim().endsWith("?")`)

**Root cause:**  
The check is purely syntactic: it tests whether the concatenated text of all text blocks, after trimming trailing whitespace, ends with `?`. TypeScript optional chaining (`foo?.bar`) and nullish-check ternaries (`x ? a : b` in the middle of a code block) will trigger this if they happen to appear at the very end of the assistant's output.

**Concrete counterexample:**

The assistant explains how to call a function, and the final text block is:

```
Here is the safe accessor: `session?.id`
```

`text.trim()` → `"Here is the safe accessor: \`session?.id\`"` — ends with `` ` ``, so no trigger here, but consider:

```
To access it: result?.value?
```

…where the author intended a rhetorical trailing `?` inside a code snippet. Or more concretely the assistant produces:

```typescript
const val = map.get(key)?
```

(an intentional incomplete expression in a code demonstration). `trim().endsWith("?")` → `true` → stop hook silenced indefinitely for this turn. The flow never re-prompts; the FSM is stuck.

A minimal reproduction: the AI is mid-flow and outputs exactly `"Use \`obj?.prop\`"` as its final word — the `` ` `` terminator saves it here, but `"Use obj?.prop?"` (trailing rhetorical question about the expression) does trigger it.

**More realistic trigger:** The user's flow asks the AI to check whether a feature exists. The AI replies:

> "The feature flag is enabled. Should I also validate `config?.debug`?"

`trim().endsWith("?")` → `true` — but the AI was not asking a question requiring user input; it ended a sentence and then appended a code expression referencing optional chaining. The guard fires anyway, suppressing the re-prompt for this entire turn.

**Severity:** High — guard can be defeated by any output that happens to end with `?` for non-question reasons, permanently silencing re-prompts for that turn.

---

### D2-002 — `isAskingQuestion`: URL query strings trigger false positive

**Violated:** Same post-condition as D2-001.

**Location:** `stop-guards.ts:37`

**Root cause:** Same syntactic check.

**Concrete counterexample:**

The AI prints a URL as its last line:

```
See the docs at: https://example.com/api?version=2&lang=en
```

`text.trim()` ends with `en` — no trigger. But:

```
Endpoint: POST /search?q=
```

(trailing query param without value) → ends with `?` → false positive. The stop hook is silenced even though the AI did not ask the user anything.

More precisely, any truncated or stub URL the LLM prints that ends with `?` (e.g., when demonstrating a query-string template) defeats the guard.

**Severity:** Medium — realistic but requires the AI to end its entire response with such a URL.

---

### D2-003 — `isAskingQuestion`: trailing `?` inside a Markdown code block

**Violated:** Same post-condition as D2-001.

**Location:** `stop-guards.ts:37`

**Root cause:** `stableStringify` is not involved here; the issue is that `text` is the raw rendered Markdown including fences. A code block ending in `?` is indistinguishable from a question.

**Concrete counterexample:**

```markdown
Here's how you can match optionals:

```rust
fn get(map: &HashMap<&str, i32>, k: &str) -> Option<i32> {
    map.get(k)?
}
```
```

The text block for this message ends with `}` after the closing fence — no trigger. However, if the AI omits the closing fence (a common hallucination):

```markdown
Here's the pattern:

```python
result = data.get("key")
# returns None if missing?
```

`text.trim()` ends with `?` → guard fires.

Additionally, if the content block is split and one text block contains only a closing fragment ending in `?`, the concatenation (`join("")`) still ends with `?`.

**Severity:** Medium — hallucinated or truncated fences are common in constrained contexts.

---

### D2-004 — `CONFIRM_STOP_TAG`: `includes()` fires on tag inside a code fence

**Violated:** Post-condition of the confirm-stop guard  
> *"Returns `true` iff the assistant has explicitly signalled user consent to abandon the flow."*

**Location:** `index.ts:671`
```ts
if (last && last.content.some((c) => c.type === "text" && c.text.includes(CONFIRM_STOP_TAG))) return;
```

**Root cause:**  
`String.prototype.includes` is not context-aware. If the assistant is explaining the plugin's escape-hatch mechanism, it will naturally print the tag as literal text within a code span or code block:

> "To abandon the flow, output `<STEERING-FLOW-CONFIRM-STOP/>` in your next reply."

The text content of the assistant message then contains `<STEERING-FLOW-CONFIRM-STOP/>` verbatim. `includes(CONFIRM_STOP_TAG)` → `true` → stop hook exits, treating this as an explicit user-consent signal. The FSM is silently abandoned even though the AI was only documenting the feature, not invoking it.

**Concrete counterexample:**

1. User is mid-flow and asks: "What happens if I want to stop?"
2. AI (correctly) explains: "You can output `<STEERING-FLOW-CONFIRM-STOP/>` to abandon."
3. Guard at line 671 fires → `return` → no re-prompt.
4. Flow is now permanently silenced for this turn; the FSM remains on disk but will never re-prompt until the next `agent_end` where the tag is absent.

Because this fires at the *guard* level (not as a state transition), the FSM is *not* popped from the stack; it is simply not re-prompted. The next interaction may re-trigger the stop hook (if the AI's next response does not contain the tag), but the turn where the explanation occurred is lost.

**More severe variant:** If the flow instructions themselves mention the tag (e.g., a state description says "output `<STEERING-FLOW-CONFIRM-STOP/>` only if…"), `renderStateView` embeds that text in the reminder, and the AI may faithfully echo it back, again triggering the guard.

**Severity:** High — this is a systematic false positive whenever the tag is documented or echoed.

---

### D2-005 — `stableStringify`: `undefined` and `null` produce identical hashes

**Violated:** Invariant of stagnation hash  
> *"`hash(s, t₁) = hash(s, t₂)` iff `t₁` and `t₂` are semantically equal tapes."*

**Location:** `index.ts:92`
```ts
if (v === undefined) return "null";
if (v === null || typeof v !== "object") return JSON.stringify(v);
```

`JSON.stringify(null)` also returns `"null"`. So both `undefined` and `null` map to the string `"null"`.

**Concrete counterexample:**

Given `TapeValue = string | number | boolean | null | TapeValue[] | { [key: string]: TapeValue }`, `null` is a valid tape value. An array `[null, "x"]` hashes as `["null","x"]`. If somehow `undefined` appeared (e.g., `[undefined, "x"]` via JSON parse or explicit assignment in a flow action), it would hash as `["null","x"]` — identically.

In practice `TapeValue` excludes `undefined` by type, but:
- `JSON.parse` of a JSON file with a missing key produces `undefined` for the property (actually omits the key; this is safe).
- A tape written with a key set to `null` explicitly and then read back will hash as `"null"` — same as if the key were absent and `stableStringify` were called on `undefined`.

**Real impact:** If a flow action sets a tape key to `null` (valid) vs. not setting it at all (key absent → `undefined` via `(tape as any)[key]`), the stagnation hash would be identical if stableStringify were called on just that value — but since `Object.keys` only returns own enumerable keys, absent keys are simply not serialized. The collision only occurs if `undefined` explicitly appears as an array element or is passed as the root value. Severity is bounded by how `TapeValue` is used.

**Severity:** Medium — the type system prevents most cases, but the function's contract is silently broken for `undefined` inputs, which can arise from untyped call-sites or future refactors.

---

### D2-006 — `stableStringify`: `Date` objects hash as `{}`

**Violated:** Invariant of stagnation hash (same as D2-005).

**Location:** `index.ts:95–96`
```ts
const keys = Object.keys(v as Record<string, unknown>).sort();
return "{" + keys.map(k => ...).join(",") + "}";
```

`Date` objects have no own enumerable string keys. `Object.keys(new Date("2024-01-01"))` → `[]`. Therefore `stableStringify(new Date("2024-01-01"))` → `"{}"` and `stableStringify(new Date("2025-06-15"))` → `"{}"`.

**Concrete counterexample:**

A flow stores a date in tape:
```json
{ "deadline": "2024-01-01T00:00:00.000Z" }
```

Since tape values are stored as JSON strings, and `stableStringify` receives a `string` for `"deadline"`, this specific case is safe (`typeof v !== "object"` → falls to `JSON.stringify`).

However, if a flow action explicitly assigns a `Date` object to a tape key (possible because `TapeValue` includes `{ [key: string]: TapeValue }` which could be a `Date` after cast), both `new Date("2024")` and `new Date("2025")` hash as `{}`. A state that changes only the date value in tape would hash identically across turns, making the stagnation detector think nothing changed.

**Severity:** Low — requires explicitly placing a `Date` object in tape, which is unusual given JSON serialization; practical risk is low but the function is silently wrong.

---

### D2-007 — `stableStringify`: no circular-reference guard

**Violated:** Pre-condition of `stableStringify`  
> *"Input is a finite, acyclic JSON-serializable value."*  
This pre-condition is implicit and unenforced.

**Location:** `index.ts:91–97` (entire function body)

**Root cause:** The function recurses via `stableStringify((v as Record<string, unknown>)[k])` without any visited-set guard. A circular object causes infinite recursion → call-stack overflow → uncaught `RangeError`.

**Concrete counterexample:**

```ts
const a: any = {};
a.self = a;
stableStringify(a); // RangeError: Maximum call stack size exceeded
```

While `TapeValue` cannot be directly circular by its type definition, objects stored as `TapeValue` (the `{ [key: string]: TapeValue }` recursive variant) could form a cycle at runtime via untyped code paths.

If this `RangeError` propagates out of the stop hook's `try/catch`, the outer catch swallows it (the hook never throws), meaning the stagnation counter never increments and no re-prompt is sent — silently disabling the stop hook for that turn.

**Severity:** Low — circular tape values are not constructible through normal flow actions (all tape I/O goes through JSON serialization which would error first), but the function lacks a defensive guard for belt-and-suspenders safety.

---

### D2-008 — Stagnation branch: comment says "Reset count" but writes `nextCount`

**Violated:** Code comment correctness (not a runtime invariant violation, but a documentation invariant).

**Location:** `index.ts:719–723`
```ts
// Reset count so the next real transition re-enables the hook.
await writeState(sessionDir, topId, rt.current_state_id, rt.transition_log, {
    reminder_count: nextCount,   // ← writes e.g. 4, 5, 6, ...
    last_reminder_hash: hash,
    preserve_entered_at: true,
});
```

**Root cause:** The comment claims the count is reset to allow re-enabling the hook after a real transition. In reality, `reminder_count` is written as `nextCount` (which exceeds `STOP_HOOK_STAGNATION_LIMIT` by definition at this branch). The actual re-enable mechanism is hash-driven: on the next call, if `current_state_id` or `tape` has changed, `prevHash !== hash`, so `nextCount` resets to `1` regardless of the stored `reminder_count`. The comment describes the *effect* but not the *mechanism*, and actively misdirects: it implies `reminder_count` is set to `0` or `1`, but it is not.

**Impact:** Any developer reading this comment would expect a reset to `0` or `1`. They might write a test asserting `reminder_count === 0` after stagnation detection — and that test would fail. They might also incorrectly believe that deleting `last_reminder_hash` is unnecessary because the count reset handles re-enable.

**Severity:** Low — functionally correct; only the comment is wrong.

---

### D2-009 — Compaction cooldown is per-session, not per-FSM

**Violated:** Invariant  
> *"Compaction cooldown for FSM-A must not affect the stop hook of FSM-B in the same session."*

**Location:** `index.ts:101`, `651–652`, `674–675`

```ts
const lastCompactionAt = new Map<string, number>(); // sessionId → ms

pi.on("session_compact", async (_event, ctx) => {
    lastCompactionAt.set(ctx.sessionManager.getSessionId(), Date.now());
});

// Inside agent_end:
const lastCompact = lastCompactionAt.get(sessionId) ?? 0;
if (Date.now() - lastCompact < COMPACTION_GUARD_MS) return;
```

**Root cause:** The map key is `sessionId`. When multiple FSMs are stacked in the same session (the normal nested-flow case), they all share a single `lastCompactionAt` entry. A `session_compact` event fired while FSM-A is active (or during FSM-B's execution) sets the session-level timestamp. For the next 60 seconds (`COMPACTION_GUARD_MS`), **all** FSMs in the session have their stop hooks silenced, regardless of which FSM's context the compaction occurred in.

**Concrete counterexample:**

1. Session S has stack `[FSM-A (parent), FSM-B (child)]`.
2. FSM-B completes a turn; `session_compact` fires (history too long).
3. `lastCompactionAt.set(S, now)`.
4. FSM-B immediately transitions to `$END`; FSM-A is resumed.
5. FSM-A's next `agent_end` fires within 60 seconds.
6. Guard at line 675: `Date.now() - lastCompact < 60_000` → `true` → `return`.
7. FSM-A's re-prompt is silenced even though FSM-A's context was not compacted and FSM-A's history is intact.

**Result:** FSM-A can stall at any state for up to 60 seconds with zero re-prompts, simply because a sibling or child FSM triggered a compaction. This compounds in deep stacks (A → B → C): a single compaction at the deepest level silences the entire chain for 60 seconds.

**Severity:** High — directly violates the stop hook's core guarantee for nested flows (the most common production case).

---

### D2-010 — Compaction guard is checked outside the session mutex

**Violated:** Invariant  
> *"The decision to send a re-prompt is made atomically with respect to session state."*

**Location:** `index.ts:674–676` (outside lock) vs. `index.ts:677` (`withSessionLock(...)`)

```ts
// Guard: compaction cooldown  ← OUTSIDE the lock
const lastCompact = lastCompactionAt.get(sessionId) ?? 0;
if (Date.now() - lastCompact < COMPACTION_GUARD_MS) return;

await withSessionLock(sessionId, async () => {   // ← lock acquired AFTER the check
    ...
    await writeState(...);
    sendUserMessage(reminder);
});
```

**Root cause:** The compaction timestamp is read and the early-return decision is made before acquiring `withSessionLock`. The `session_compact` handler at line 651 sets the timestamp asynchronously:

```ts
pi.on("session_compact", async (_event, ctx) => {
    lastCompactionAt.set(ctx.sessionManager.getSessionId(), Date.now());
});
```

There is no lock protecting reads of `lastCompactionAt` relative to the mutex-guarded body.

**Concrete counterexample (TOCTOU):**

1. `agent_end` for FSM-A reads `lastCompact = 0`; `Date.now() - 0 ≥ 60_000` → guard passes.
2. Before `withSessionLock` is acquired, `session_compact` fires and sets `lastCompactionAt` to `now`.
3. `agent_end` acquires the lock and sends the reminder, injecting a re-prompt into a just-compacted session — exactly what the cooldown was designed to prevent.

This is a narrow race window (requires compaction to fire between line 675 and line 677), but it is a genuine correctness violation. In practice, Node.js's single-threaded event loop means the race requires an intermediate `await` between the check and the lock acquisition — and `withSessionLock` itself likely does not yield before checking the queue.

**Severity:** Medium — the race window is narrow in Node.js (single-threaded), but the guard and the protected block are architecturally inconsistent. The check should be inside the mutex.

---

### D2-011 — `ctx.signal?.aborted`: optional chaining masks missing signal object

**Violated:** Pre-condition of the abort guard  
> *"Abort detection must be reliable — a missing signal must not silently allow a re-prompt."*

**Location:** `index.ts:663`
```ts
if (ctx.signal?.aborted) return;
```

**Root cause:** If `ctx.signal` is `undefined` (i.e., the runtime did not provide an `AbortSignal`), `ctx.signal?.aborted` evaluates to `undefined` (falsy) and the guard silently passes. Control then falls to `wasAborted(event.messages)` at line 664, which checks `last.stopReason === "aborted"`.

This secondary guard is correct but only covers the case where the `stopReason` is recorded on the message. There is a gap: if the abort occurred but the runtime chose not to set `stopReason` (e.g., the stream was externally cancelled before the message was finalized), neither guard fires, and the stop hook proceeds to re-prompt during an aborted session.

**Concrete counterexample:**

- Runtime initializes `ctx` without an `AbortSignal` (allowed by the optional type) and externally terminates the stream mid-generation.
- The last message may have an empty or `undefined` `stopReason`.
- `ctx.signal?.aborted` → `undefined` (falsy) → guard skipped.
- `wasAborted(messages)` → `last.stopReason === "aborted"` → `false` (stopReason not set).
- Stop hook fires re-prompt into an aborted/closed session context.

**Severity:** Low — the two-guard pattern provides reasonable defense in depth. The failure case requires both `ctx.signal` to be absent *and* `stopReason` to be unpopulated, which is an unusual runtime configuration.

---

## Guard Order Analysis

The guards execute in this order (lines 663–676):

```
1. ctx.signal?.aborted                          (line 663)  — async-signal abort
2. wasAborted(event.messages)                   (line 664)  — message-level abort
3. isAskingQuestion(event.messages)             (line 667)  — question detection
4. includes(CONFIRM_STOP_TAG)                   (line 671)  — explicit abandon tag
5. compaction cooldown (outside mutex)          (line 674)  — D2-010
6. [inside mutex] stack empty / $END check      (~line 680) — stack sanity
7. [inside mutex] stagnation logic              (~line 704) — D2-005/008
```

**Guard state leakage:** Each guard is a pure read of `event.messages` or module-level state (`lastCompactionAt`). Guards do not write any shared mutable state before the mutex; there is no leakage between evaluations. The module-level `lastCompactionAt` map is the only shared state touched pre-mutex, and it is only read here (written only by `session_compact`). **No guard leaks state into the next guard.**

**Order correctness:** The abort guards correctly precede all others — aborting a request must take priority over flow logic. The question guard correctly precedes the stagnation guard — a question should suppress the reminder even if stagnation is detected. The CONFIRM_STOP_TAG guard correctly precedes compaction — explicit abandon takes priority over cooldown. The only ordering concern is D2-010: the compaction guard should be inside the mutex.

---

## Recommendations

| ID | Fix |
|----|-----|
| D2-001/002/003 | Replace `text.trim().endsWith("?")` with a more robust heuristic: strip trailing code blocks (` ``` ` fences) and code spans (`` ` ``…`` ` ``) before checking, or require the `?` to end a prose sentence (preceded by a letter/punctuation, not `` ` `` or alphanumeric). Alternatively, require the `question` tool call as the sole signal and deprecate the text heuristic. |
| D2-004 | Change the CONFIRM_STOP_TAG check to require the tag to appear outside Markdown code fences. A simple approach: split the text on `` ``` `` blocks and only search non-fence segments. Alternatively, use a tag that is less likely to appear in prose (e.g., a UUID-suffixed tag). |
| D2-005 | Change `if (v === undefined) return "null"` to `return "\"undefined\""` or throw — make `undefined` distinguishable from `null`. |
| D2-006 | Add a `Date` branch: `if (v instanceof Date) return JSON.stringify(v.toISOString())`. |
| D2-007 | Add a `seen: WeakSet` parameter to detect cycles and throw a `TypeError("circular")` rather than stack-overflowing. |
| D2-008 | Fix the comment at `index.ts:719` to read: *"Write incremented count; the hook re-enables when hash changes on next call."* |
| D2-009 | Key `lastCompactionAt` by `fsmId` (or `sessionId + "/" + fsmId`) rather than `sessionId`, so each FSM has its own cooldown window. |
| D2-010 | Move the compaction cooldown check inside `withSessionLock` to make the guard decision and the re-prompt atomic. |
| D2-011 | Add an assertion or fallback: if `ctx.signal === undefined`, log a warning but do not silently continue; alternatively treat `ctx.signal === undefined` as "not aborted" only after verifying `stopReason` is also not `"aborted"` (current behavior is already approximately correct). |
