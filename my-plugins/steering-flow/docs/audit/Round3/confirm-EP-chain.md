# Independent Confirmation: EP-01 + EP-02 + EP-07 Chain

**Verdict: CONFIRMED-triggering**

## Evidence

**Claim 1 (EP-01: no shape validation in readState)** — Confirmed. `readJsonStrict<T>` (storage.ts ~line 55) parses JSON and casts the result `as T` with zero runtime shape validation. `readState` (line 233) delegates directly to `readJsonStrict<StateFile>` adding nothing on top. An input like `{"garbage": true}` parses successfully and is returned as a `StateFile` where every expected field (`current_state_id`, `entered_at`, `last_transition_chain`, `reminder_count`, `last_reminder_hash`) is `undefined`. Notably, `readTape` and `readFsmStructure` both perform post-parse shape checks — `readState` is the only reader that skips validation entirely.

**Claim 2 (EP-07: writeState preserve_entered_at re-reads and assumes shape)** — Confirmed with nuance. `writeState` (line 220) calls `readState` and accesses `existing?.entered_at` with optional chaining. This means a garbage object silently yields `undefined` for `entered_at`, causing a fallback to `new Date().toISOString()`. The result is silent data loss (entered_at timestamp reset) rather than a throw. The practical effect is that stagnation time tracking is corrupted — the FSM believes it just entered the current state.

**Claim 3 (EP-02: bare catch in agent_end)** — Confirmed. The `agent_end` handler (index.ts line 636) has an outermost `catch {}` at line 723 with no error parameter, no logging, and no notification (comment: "Hooks must never throw"). The `readState` call at ~line 680 sits inside the lock callback with no inner try/catch. If state.json contains unparseable JSON, `readJsonStrict` throws `CorruptedStateError`, which propagates directly to the bare catch and is silently swallowed. The entire stagnation tracking block — hash comparison, counter increment, writeState, and the sendUserMessage reminder — is skipped with no trace.

## Triggering Chain

The chain is reachable via two distinct corruption paths:

1. **Invalid JSON in state.json** (e.g., truncated write from external process, disk issue): `readState` throws `CorruptedStateError` -> bare catch swallows it -> stagnation tracking permanently disabled for the session. No error is surfaced to the user or logs.

2. **Valid JSON, wrong shape** (e.g., `{"garbage": true}` from a version mismatch or manual edit): `readState` returns the object successfully -> optional chaining yields `prevHash = undefined`, `prevCount = 0` -> stagnation counter resets to 1 on every `agent_end` invocation -> the reminder threshold is never reached -> the agent can loop indefinitely without the stagnation guard firing.

Both paths are realistic in a plugin that persists state to the filesystem across sessions. The atomic write mechanism (tmp + rename) mitigates partial writes but does not prevent semantic corruption from bugs, version migrations, or external interference.
