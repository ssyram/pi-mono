# Task-system patch — dormant architecture

Status: dormant infrastructure implemented and directly tested. Runtime registration and interface changes remain NOT APPROVED. See [verification.md](verification.md) and [integration-plan.md](integration-plan.md).

The subsequent [exception-safety-scope.md](exception-safety-scope.md) governs the delivered boundary repairs. [HOARE-EXCEPTION-SAFETY.md](HOARE-EXCEPTION-SAFETY.md) preserves the independent BEFORE-FIX analysis; [EXCEPTION-SAFETY-DELTA.md](EXCEPTION-SAFETY-DELTA.md) records implementer repair reasoning, the complete final function inventory, and remaining caller obligations. No independent post-fix audit or deployed no-throw guarantee is claimed.

## Ownership and interface boundary

New leaf modules live under `tools/task-system/`; new tests use `test/task-system-*.test.ts`. Nothing under the existing runtime entry graph imports them in this gate. No existing active source, agent profile, prompt, configuration or protected test is edited; dormant source and superseded dormant fault expectations may be corrected under the authorized exception-safety scope. Two task-system-scoped check configs may be added if needed without changing root configuration.

The infrastructure should expose one coherent request-processing boundary, separate human clearing, branch restoration/ID allocation, list selection and a tool-admission decision. It may provide an unregistered tool schema/definition or callback adapter for direct tests. It must not register anything at module load or duplicate the provider/scheduler runtime. The final integration plan will name actual exports and exact caller obligations rather than promise a three-line total diff.

## D1 — data and identity

Retain the current task fields and statuses; add optional `closedOrder`. Keep numeric IDs and the owning session as the implicit ID namespace. Persist only real numeric dependencies. An alias exists only in one batch.

Maintain a session-local allocation high-water mark: clearing preserves it; restoring an older branch does not lower it. Bootstrap from the owning session's existing task snapshot history at restore time, not on every add. No module-global counter across sessions. Forked sessions may retain copied IDs under their new session identity. Do not retroactively rewrite old session history. Do not reuse issued IDs to fill holes after a failed commit; document native persistence limits honestly.

A successful done/expire operation gives the task the next closedOrder. Derive the next value from the full current state or an equivalent session-owned value; dependency changes never update it. This order is not a wall-clock timestamp. Old terminal records without it remain valid and sort after known orders, with descending ID as a stable unknown-order fallback.

## D2 — model request shape

Retain list/add/start/done/expire/update_deps. The model schema and dispatch must both omit/reject clear. Human clearing is a separate internal entry point for a future `/task clear` command.

Single add accepts text and optional start/blockedBy. Batch add uses `tasks: [{ key?, text, start?, blockedBy? }]`; top-level text and tasks are mutually exclusive. Creation does not need blocks: use the dependent item's blockedBy. Existing update_deps continues to support both directions.

A numeric creation dependency names a task present before the call. A string dependency names a unique accepted key in this batch, including a forward reference. Callers must not predict IDs of new items. Keys use exact string equality; no global key store. Missing/blank text or invalid/duplicate keys are reported per item; do not guess aliases. A later duplicate key item is skipped and the earlier valid binding remains. References to a skipped/unknown key are reported and not added.

Normal tool argument-shape validation remains. Best effort applies to per-item business validation in a well-shaped batch, not invalid JSON, arbitrary wrong field types, or I/O errors. The batch item schema deliberately permits omitted text and numeric references before semantic validation: missing/blank text skips that item; negative/fractional/unsafe numbers skip that edge. A non-string text or an object dependency rejects the request. Scalar creation still requires text and validates all requested effects before publishing.

## D3 — batch algorithm

1. Work on a cloned candidate state. Validate items independently and create every acceptable item in input order as pending, assigning IDs and recording accepted keys. Return the mapping and per-item issues.
2. Visit created items in original input order, then their blockedBy entries in original array order. Resolve existing numeric IDs or accepted batch keys. For each candidate edge, reject missing/self/duplicate/unsafe references or a cycle-closing edge, report it, and continue; accepted edges update both ends immediately in the candidate graph. This order makes which edge is skipped deterministic.
3. Accept legal done/expired prerequisites. Report explicitly: edge added; prerequisite already done/expired; blocking state unchanged. Do not treat the terminal status as an error.
4. After ALL edge requests have been processed, attempt every requested start. If unblocked, mark in_progress. Otherwise leave pending (displayed blocked) and report that creation succeeded but start did not.
5. Return the complete candidate state and truthful per-item/per-edge outcomes. Future runtime commits the resulting snapshot and notifies once when effects exist. No old action loop that persists each item separately.

Example: A requests blockedBy B, B requests blockedBy A. Accept the first edge, skip the second as cyclic. If both requested start, A remains blocked and B starts. Neither created task is rolled back because the second edge failed.

This is semantic partial success. Do not set a whole-call failure solely because one edge or start was skipped; the result must still visibly indicate partial execution. If an item cannot be created, no ID is assigned to that item. No invented placeholder task stands in for it.

## D4 — single operations and state transitions

Preserve the existing single start/update_deps error behavior: invalid dependency updates reject that update, rather than silently retaining some requested edges. Single creation with shortcuts validates its requested effect before publishing it; do not silently apply batch partial-success rules to the scalar add form.

A legal dependency update can create unresolved prerequisites for one or more existing in-progress dependents. Set those affected tasks to pending so they display blocked. Once their prerequisites are done/expired or removed, they are ready and require explicit start. This does not cancel already admitted tools or background work. Terminal prerequisites remain legal and satisfied; accepted terminal-edge additions should report the non-blocking effect.

Existing done/expire semantics remain except for recording closedOrder. Keep original status meanings, expiry reasons and reciprocal edges. Do not add a one-in-progress limit or an automatic start policy.

## D5 — list views

`list` without type or limit returns every open task followed by at most ten recent closed tasks combined. Open order: in_progress, ready, blocked, with stable numeric order within a group. Closed order: closedOrder descending, then unknown-order legacy items by descending ID.

Explicit type is one of open/closed/in_progress/ready/blocked/done/expired. Filter one class, then apply optional nonnegative integer limit; no limit means all matching tasks. A limit without type is an argument-combination error. No type=default, closedLimit, arbitrary unions or pagination framework.

Compute dependency/readiness against the full state, not a filtered display array. Model-facing content and rendered list details must represent the same selected set. Full state, persistence, Boulder and compaction readers are never truncated. Pure selection should expose enough information for a future renderer without rewriting the current widget in this gate.

## D6 — future tool admission and human clear

Admission permits exact tool name task without reading state, otherwise requires at least one current-session task with status in_progress AND no unresolved prerequisite. Ordinary reader/classifier failures return an explicit block with a constant diagnostic, not an exception or fail-open. No read-only, supervisor, waiting, subagent or wrapper exceptions. Use native tool_call block results, without terminate; refusals are ordinary Pi error results rather than thrown application errors.

The future task definition requests executionMode=sequential so a mixed native batch observes task mutations in order. Ordinary non-task batches retain their native parallel behavior. A single gate cannot revoke running work or guarantee rechecking a wrapper's direct internal calls.

Future OMP-owned profiles that load the gate must include task in their explicit tool allowlist and remove skip-task instructions. External profiles excluding task are a configuration conflict: report it and remain fail-closed; do not silently override capability limits. Pure visibility/admission helpers and unregistered registration adapters can be tested now; existing profiles and extension.ts MUST NOT change yet.

Human clear removes current tasks but preserves the session allocation high-water mark. Exposing that operation to a future human command does not expose it as a model action. This is an interface restriction, not a sandbox against arbitrary filesystem access.

## D7 — human command extension (dormant)

The human parser receives the string AFTER `/task`. Supported grammar (case-sensitive):

```text
add TEXT [--start] [--blocked-by IDS]
modify ID [--text TEXT] [--blocked-by IDS] [--status STATUS] [--reason TEXT]
list [--type TYPE] [--limit N]
clear --CONFIRMED
```

TEXT is one token; quote text containing whitespace. Whitespace separates tokens outside quotes. Single quotes preserve everything literally until the closing single quote. Double quotes allow backslash to quote the next character; unquoted backslash does the same. Adjacent quoted/unquoted pieces form one token. There is no shell expansion, variable expansion, substitution, or special `\\n` decoding. Unterminated quotes and trailing escapes are errors. An option value beginning `--` must be quoted or escaped. Flags use separate values, not `--name=value`; unknown, duplicate, misplaced, and missing-value flags are rejected.

IDs are canonical positive decimal safe integers (no sign, leading zero, fraction, exponent, or hex). IDS is comma-separated IDs without spaces; the empty quoted token `--blocked-by ""` clears dependencies. N is canonical nonnegative decimal safe integer. TYPE uses the same seven model list types; limit requires type. STATUS is only `in_progress`, `done`, or `expired`; these invoke existing start/done/expire semantics, not direct assignment. Expired requires nonblank `--reason`; reason without expired is invalid. Modify requires at least one effective option. No pending/ready/blocked status setter or reopen operation is introduced.

Parse and validate the complete command before mutation. Add/list reuse scalar model request processing; clear reuses high-water-preserving clearing. Modify clones the full state, validates/replaces nonblank text, applies dependencies through the existing request executor, then applies lifecycle through that executor. Any error discards every candidate change and reports no modification; successful combined edits persist once. Text-only changes update updatedAt but preserve IDs, graph, status and closedOrder. Accepted dependency notices and demotions remain visible. The shared session controller contains transformation/persistence failures and returns an error TaskOperation. Transformation faults publish nothing; persistence faults retain old controller records and reserved ID floor while reporting native-log/disk uncertainty. No second human state store or separate ID allocator exists. The pure human transform remains fallible and is not the harness entry point.

Bare input and show/info/help are NOT redefined by this leaf parser: future routing preserves their existing command handler.

## D8 — human autocomplete (dormant)

One native AutocompleteProvider-shaped factory wraps the caller's current provider. It owns task roots (including existing show/info/help), show on/off, valid unused flags for each new action, fixed status/type values, modify IDs and comma-separated dependency IDs. Free text/reasons, unconstrained numeric limits and unrelated input delegate to the current provider. No command registration, state mutation, persistence, graph-validation substitute or speculative ID allocation occurs.

A tolerant lexer follows D7 quoting/escape semantics but retains raw token spans and permits the token at the cursor to be unfinished. The completion context identifies positional text versus IDs, options versus values, and already-used flags without treating quoted flag-looking values as options. Completion replaces the current token (not merely its prefix); for dependency lists only the current comma component is changed, retaining preceding/following components. Existing simple quote style is retained; adjacent/escaped pieces may be normalized to an equivalent token. Text outside that token and following arguments remain unchanged. Incomplete quotes on owned values are closed on insertion. Free-text quotes remain untouched by this provider.

ID choices are read anew on each ID suggestion and application from a caller-supplied actual-session reader. Include terminal tasks, exclude the modify target and other selected dependency IDs, and match either canonical numeric-ID prefixes or case-insensitive task-text substrings; the inserted value is always the numeric ID. No array captured at session_start and no global cache. A disappeared or otherwise stale candidate is not inserted at application time. Suggestion exceptions or delegated promise rejections resolve to null; application exceptions return unchanged lines/cursor; trigger exceptions return false. Delegates receive separate editor arrays, so mutation-then-throw cannot corrupt caller input. Recovery does not retry readers/delegates or stringify the thrown value; null means no completion, not an authoritative empty task store. The caller supplies the same actual-session owner used by commands/model actions and rebuilds the provider with session lifecycle replacement.

All fixed values/flags use case-insensitive prefix matching and canonical lowercase insertion; legacy root/show matching preserves loose matching. The provider handles editor cursor offsets and preserves unmodified lines. It only assists a partial command: expiry reason, list type, graph legality, etc. remain executor requirements.

## Direct evidence required before proposed integration

- Input immutability, session isolation, deterministic IDs, restoration after clear/branch/fork and no new ID reuse.
- Batch forward references; valid tasks survive bad items/edges; cycles skip only the closing edge; starts occur after all edges; skipped starts retain created blocked tasks; precise terminal-edge success notices.
- Single-operation failure behavior, running-to-blocked transition including indirect edge endpoints, unblocking to ready, terminal states and closure ordering.
- Default mixed list, every explicit type, limits, invalid limit-only requests, old closure-order fallback, preservation of hidden/full state and output/render selection agreement.
- Task-only exception, all other names denied without active unblocked work, per-session predicates, hard-allowlist diagnostics, and proposed sequential metadata. Clearly distinguish pure/adapter tests from live loaded-host guarantees.
- No production imports/registration or changes to protected runtime/profile bytes; unchanged staged work. Scoped strict types/formatting and required full root check; report existing baseline failures, never repair unrelated packages.

## I — later wiring, not authorized now

[integration-plan.md](integration-plan.md) records actual exports and concrete call sites in tools/task.ts, task-state persistence, commands/task.ts and completion/help, extension.ts, rendering and OMP profiles. It also records the built/native type boundary, scheduler acceptance prerequisites and persistence limitations. This plan is not applied; no reload is requested.

## Implemented boundaries

- `executeTaskRequest` clones the authoritative state before invoking existing single-action graph/lifecycle helpers. The private-use batch helper mutates only that candidate. `TaskOperation.state` always contains the complete graph; list `details.tasks` and `details.rows` contain only the selected view.
- Mutation content reports effects rather than retransmitting the full task list. `details.partial` means at least one batch request was skipped. When no effect was accepted, content says `Nothing applied`, not `Partially applied`.
- `createTaskSession` owns a cloned state per caller-created session controller; snapshot/result mutation cannot alter that state. Callers must assign different controllers to different actual session identities. No module-global map/counter is introduced.
- Persistence callbacks are synchronous and non-reentrant. The controller reserves nextId, prepares detached installation/persistence snapshots, invokes persist once, then installs by assignment only. A caught failure returns a plain error operation with old controller records/higher floor, not a rich row formatter or uncommitted candidate. It neither compensates the native session log nor coordinates multiple processes.
- `restore` returns `{ ok: true } | { ok: false, error }`; on failure no new state is installed. It cannot catch argument-evaluation failures. Future owner/history lookup must be inside a caller envelope, and a failed current-branch restore must keep that owner unavailable until a successful restore. `clear` now returns TaskOperation through the same human path.
- Generic tool callback failure returns `TaskBoundaryErrorDetails` with action=error, stateUnavailable=true and a constant message. No fake empty state or assertion of rollback is supplied. Session error details also use action=error, but retain the known detached state; rows/outcomes are empty because failure recovery does not reclassify or format them. Neither adds native isError.
- Successful publication precedes notification/output. Future callers must catch later presentation failures separately, retain the committed result and report presentation failure without retrying persistence. Pure `executeTaskRequest`, `executeHumanTaskCommand`, parsing and graph helpers retain their explicit valid-state contracts.
- IDs and closure orders are safe integers. Allocation stops before nextId would cease to be safe; closure-order exhaustion rejects the closure operation. Existing legacy records without closedOrder remain readable.
- The returned tool definition is data plus an execute callback; no registration side effect. Tests verify metadata and direct adapter behavior, not a live native scheduler, provider or child process.
