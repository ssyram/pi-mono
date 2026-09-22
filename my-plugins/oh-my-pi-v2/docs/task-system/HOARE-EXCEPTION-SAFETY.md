> Archived independent BEFORE-FIX analysis. Its 85-body inventory and line anchors describe the original implementation, not the repaired code. See [EXCEPTION-SAFETY-DELTA.md](EXCEPTION-SAFETY-DELTA.md) for separately labelled implementer repair reasoning and final inventory. No independent post-fix audit is claimed.

# Crash Safety Audit Report — dormant task system, before repairs

## Summary

The candidate-state and ID-reservation design preserves task records under the tested ordinary persistence faults, but the dormant harness-facing interfaces do not yet satisfy the newly approved containment contract. Autocomplete is the highest-impact gap: its failures reach native editor paths without containment and a rejected suggestion poisons subsequent autocomplete requests.

This is ONE independent natural-language Hoare analysis, not a machine proof, deployment acceptance, or repair implementation. No prior worker report or endorsement was used as proof. Standards are `docs/task-system/exception-safety-scope.md` (read FIRST), then current `principles.md` and `architecture.md`; existing accepted task semantics remain intact. Line numbers refer to the audited pre-repair files; function anchors are authoritative.

## Authority, boundaries, and notation

- **New contract:** exception-safety scope required postconditions 1–9. In particular, explicit errors are acceptable; recoverable task failures must not escape the plugin's harness-facing boundaries. Persistence uncertainty is not rollback. Admission must refuse explicitly on read/classification failure. Suggestion failure means no completion; application failure means unchanged input/cursor, without retrying a failed dependency.
- **Superseded policy:** architecture D7/D8 and Implemented boundaries, and integration-plan §1/§3/§3a, describe or prescribe propagation of persistence/unexpected/reader failures. Architecture's opening supplement notice explicitly supersedes those statements at boundaries. The old tests expecting rejection describe the old behavior; they do NOT establish compliance with the new contract.
- **V(S):** a caller-established complete task state: unique positive safe IDs, safe nextId greater than every ID, reciprocal existing-ID edges, acyclic graph, valid text/status/timestamps, optional safe-positive closedOrder. All records and dependency arrays are ordinary task data. Pending readiness is derived against the full graph. A legacy in-progress task may have blockers and must not admit other tools. Initial state/history ownership belongs to the actual session identity.
- **H:** session allocation floor; must not decrease during that controller's lifetime. This does not promise preservation across loss of all durable issuance evidence or retroactive correction of already-reused historical IDs.
- **E:** ordinary exceptional exit. Unless specifically noted, pure transforms allocate local candidates and E leaves their caller's input unchanged. Allocation/engine/process failure is outside the promised no-throw guarantee; no artificial size cap is inferred.
- **Published** means the controller installed the candidate after its synchronous persistence callback returned. Native log/disk effects can precede that return and are not reversible by the controller.
- Requires below are derived from the design and actual call chains. A public export is not automatically a harness callback. No catches or validation are demanded at every private helper. Async persistence/run callbacks are NOT supported by the present synchronous contracts; asynchronous suggestion delegates ARE supported by the native interface.
- No implementation here opens a file descriptor, socket, timer, or lock. Its externally visible resources are the controller state, native session log through the supplied persistence callback, and the native editor's callback/promise chain.

## Critical Issues

### C1 — Completion failures escape into native input handling and poison the suggestion queue

- **Location:** `tools/task-system/human-completion.ts:76` getSuggestions, `:85` applyCompletion, `:105` shouldTriggerFileCompletion; native `packages/tui/src/components/editor.ts` requestAutocomplete/startAutocompleteRequest/runAutocompleteRequest and handleInput.
- **Classification:** Non-Decisional. The approved fallback policy is already explicit.
- **Requires:** a provider wrapping the actual current provider and a current-session reader; either may encounter an ordinary error. Native suggestions permit promises; application and trigger are synchronous.
- **Postcondition violated:** scope §7–8: suggestion callbacks resolve to no completion on failure; application preserves editor input/cursor; trigger fallback cannot let delegate errors escape; recovery does not call the failed reader/provider again.
- **Concrete counterexample:** `readTasks = () => { throw new Error('state read failed'); }`, input `['/task modify ']`, cursor `(0,13)`, non-aborted signal. getSuggestions rejects; applyCompletion with item `{value:'2',label:'2'}` and prefix `''` throws. For `['outside']`, a delegate that throws synchronously or returns a rejected suggestion promise escapes too; throwing apply/trigger delegates also escape. These are supported ordinary callback faults, not malformed requests or simulated OOM.
- **Reachable path:** future task provider → native Editor.runAutocompleteRequest → await suggestions → startAutocompleteRequest's stored task rejects. startAutocompleteRequest awaits the PREVIOUS stored task before running the next provider. The second request therefore rejects before calling its provider. requestAutocomplete launches that async function with `void` and no catch. Synchronous apply/trigger exceptions likewise have no local editor catch; TUI.handleInput directly invokes the focused component. InteractiveMode's last-resort uncaughtCrash exits the process rather than recovering task UI.
- **Direct evidence:** P5–P7 below. The actual workspace built Editor.startAutocompleteRequest method, called on an isolated receiver with every promise awaited/caught by the probe, produced **2 rejected requests, only 1 provider invocation**. No live TUI or uncaught process failure was triggered.
- **Impact:** disabling subsequent completion in that editor and potential uncaught input/rejection termination after integration. This is not a claim that the dormant provider is currently installed.
- **Root cause:** returned callbacks lack envelopes around reader, context/choice construction, delegates, and insertion. `return current.getSuggestions(...)` adopts its rejection but does not contain it.
- **Minimal repair direction:** contain the whole suggestion callback, including **awaiting** delegated suggestions inside its try; return null on ordinary failure. Contain application and use a pre-delegation copy of editor lines/cursor for its no-op result (a delegate receives mutable lines). Contain trigger/delegate failure with the already-approved no-completion behavior, not a second delegate attempt. Do not replace a failed task read with an authoritative empty task state, and do not invoke the reader in fallback construction. Native input contracts justify relying on the supplied string array and integer cursor, not on arbitrary fabricated data.

## Moderate Issues

### M1 — Controller mutation boundaries and the tool run adapter expose ordinary persistence/callback failure

- **Location:** `tools/task-system/session.ts:11–18` commit, `:28–40` execute/executeHuman/clear; `tool-definition.ts:47–48` returned execute.
- **Classification:** Non-Decisional for containing failures and preserving the floor. Native error-result signaling and future presentation API shape are Decisional implementation-boundary choices; see N2/O3, not a license to redesign operations.
- **Requires:** V(S), synchronous non-reentrant persistence, valid ordinary model or human input. Persistence is explicitly permitted to throw, including after native log mutation. The provided `run` callback is synchronous and may encounter persistence, owner lookup, or presentation failure.
- **Postcondition violated:** scope §1–4/§8 requires an explicit native-compatible error or typed failure consumed at the caller, rather than propagation from the plugin operation boundary. The memory-preservation part of §3 DOES hold; the containment/result part does not.
- **Concrete counterexample:** a new controller, `execute({action:'add',text:'A'}, () => { throw new Error('disk failure'); })`. The call throws, leaves tasks empty, and reserves nextId=2. Wrapping this call in createTaskToolDefinition makes its execute promise reject. `executeHuman('modify 2 --text changed --status done', fail)` with existing pending #2 throws instead of returning a human failure; `clear(fail)` does the same. No malformed TaskState or async callback is needed.
- **Reachable path/probes:** P1–P3. A separate P8 uses the actual built SessionManager.appendCustomEntry with its persistence stage fault-injected; the native entry exists even though the controller retained old records. These are exactly the ordinary I/O paths the supplement newly requires containing.
- **Impact:** unclosed plugin boundary contract; direct consumers receive no typed result. Native tool execution and native slash-command dispatch ordinarily catch an Error and keep the harness running, so **this finding is NOT evidence that an Error from commit alone crashes Pi**. It remains a violation of the newly authorized plugin-boundary postcondition and a caller integration hazard.
- **Root cause:** commit deliberately reserves, invokes persist, and propagates. execute/executeHuman/clear do not catch that exit. The async tool method merely evaluates `run(...).result`; sync throws become rejections. Only parser errors are currently converted to task results.
- **Minimal repair direction:** introduce the containment at the coherent session/human/tool boundaries, retaining private transform behavior. On transformation failure keep old records; on persistence failure keep old records and the reserved floor and explicitly report native persistence uncertainty. Never retry persistence. Do not return the uncommitted candidate as successful published state. The tool adapter must contain arbitrary supported `run` errors, not assume every future run implementation already does. Keep semantic batch partial success separate from operation failure. Do not use list/row formatting, task reading, notification, or unguarded arbitrary-error stringification to construct the fallback.
- **Important boundary detail:** append/notify after successful publication is a different phase. A later notification error must not produce “no changes applied.” The current dormant controller has no notification callback; closing that phase is a future caller obligation O3, not an invented rollback defect inside commit.

### M2 — Admission reader/classifier failure does not return the required explicit refusal

- **Location:** `tools/task-system/admission.ts:10–17` taskAdmission.
- **Classification:** Non-Decisional.
- **Requires:** exact tool name and an actual-session reader. Reading/classification can fail; the gate must not infer authorization from that failure.
- **Postcondition violated:** scope §6: exact task remains exempt, but a failed non-task read/classification produces `{block:true, reason:...}`, not an exception or fail-open.
- **Concrete counterexample:** `taskAdmission('read', () => { throw new Error('reader unavailable'); })` throws. P4 verifies both this and that `taskAdmission('task', fail)` does not call the reader.
- **Observable impact:** caller receives no explicit admission decision. The traced native hook/preflight path does catch ordinary errors and blocks execution, so the current helper is **not demonstrated fail-open in Pi**. Compliance presently relies on outer framework exception behavior contrary to the new local boundary requirement.
- **Root cause:** both readTasks and the some/taskRow classification execute outside containment.
- **Minimal repair direction:** leave the exact-name early return first; contain the entire non-task read/classification and return an explicit refusal with a reader-independent diagnostic. No task read during reporting, no fallback empty authoritative store, no hard-allowlist bypass, no terminate, and no cancellation of work already running.

## Complete function inventory and Hoare derivations

An independent TypeScript AST traversal found **85 function bodies** in all 14 `tools/task-system/*.ts` files (declarations, arrows, returned methods). Every body is indexed below by filename/function/line. The additional referenced built-in `Boolean` predicate at human-completion.ts:56 is explicitly indexed too; interface call signatures have no bodies. All anonymous callbacks inherit their enclosing precondition, affect only the enclosing local accumulation unless stated, and propagate ordinary exceptions to that enclosing function's stated E exit. This is not a silent assumption that the enclosing boundary catches them.

### 1. model.ts — 2 bodies

**1.1 cloneTaskState, :71.** Requires V(S) or, for cloning alone, correctly shaped ordinary task/dependency arrays. Sequence: copy nextId; map each task; spread record scalar fields; separately copy blocks and blockedBy. Strongest normal postcondition: equal values, fresh state object/tasks array/record objects/dependency arrays; optional closedOrder/expireReason are retained. Caller mutation of a returned snapshot cannot alter the controller. E during mapping leaves caller data unchanged and no partial clone is returned. Ensures detached state, not validation of an arbitrary unknown object. Callers: execute, human execute, session construction/snapshot/commit, restore.

**1.2 task mapper, :74.** Requires one shaped record. Ensures a spread copy plus new blocks/blockedBy arrays; reads no external dependencies. It is the isolation step in 1.1, not a persistence operation.

Map loop reasoning: initiate with empty output; after k items exactly the first k records have detached copies in input order and input remains unchanged; maintenance copies item k without writing earlier inputs; termination finite input length. Representative three records: after #1 only #1 copied, after #2 copies #1/#2, after #3 copies #1/#2/#3, each with independent edge arrays. This same finite-map invariant applies to the simple mappers explicitly indexed below.

### 2. schema.ts — 2 bodies

**2.1 listTypes mapper, :17.** Requires the module's seven fixed strings. Each iteration creates its Type.Literal; final union enumerates exactly open/closed/in_progress/ready/blocked/done/expired. No session mutation. Ordinary TypeBox/module-initialization incompatibility would escape import; compatible existing installed TypeBox is a deployment precondition, not a model-request failure. No evidence of an import fault was found in probes.

**2.2 parseTaskRequest, :79.** Requires unknown JSON-like request data, not prevalidated action combinations. Check rejects wrong types, additional fields, unsupported clear/modify, unsafe scalar IDs/limits, and empty batch arrays; successful Check establishes the request union. Next branch rejects list limit without explicit type; otherwise returns the original checked request. Ensures accepted union/combination or Error, no mutation. Batch text may be omitted and numeric refs may be semantically invalid by design; their business checks are later. The caller executeTaskRequest catches parser Error. Human list parsing delegates here and is contained by executeHumanTaskCommand. No redundant catch is required inside this parser. Error messages here are locally constructed ordinary strings.

### 3. list.ts — 15 bodies

**3.1 taskRow, :4.** Requires a shaped task and complete authoritative task array. Filter dependency IDs against the full array; absent dependencies count as unresolved, as do nonterminal dependencies. Pending becomes blocked iff blockers nonempty, otherwise ready; every other stored status is retained. Return a copied task/edge arrays, derived status, and blocker IDs. Ensures no task mutation and no filtered-subgraph readiness error. E leaves input unchanged. Under V(S), missing dependency case is unreachable but the reader classifier is conservative if it occurs.

**3.2 blockers filter, :5; 3.3 dependency find predicate, :6.** For each ID the find predicate tests equality; filter retains exactly absent/non-done/non-expired prerequisites. After k IDs the blockers prefix is exactly unresolved IDs among the first k. Three prerequisites [done #1, pending #2, expired #3] yield [], [2], [2]. Both callbacks are pure; classification/read errors propagate to taskRow, then its caller (not contained in current admission/completion boundary).

**3.4 closed, :24.** Requires valid task status; returns exactly done-or-expired. No writes or ordinary failure for valid plain records.

**3.5 closedOrder, :27.** Requires task records with absent or safe-positive closedOrder. First compare descending known order (absent=0), then descending ID; unique IDs settle ties. Ensures deterministic comparator, no timestamp inference or mutation. Number subtraction is a sign comparison, not an ID allocator.

**3.6 selectTaskRows, :32.** Requires full task state and a typed optional TaskListType. It independently rejects limit unless safe nonnegative and paired with explicit type. Map all rows before selection, then independently derive sorted open/ended arrays without sorting input. No type: all open then at most ten ended. Explicit open/closed picks that group; other values filter one derived status; optional limit slices afterward. Ensures selected copied rows only, never deletes hidden records. A valid executeTaskRequest establishes the limit/type precondition, so this defensive Error is not a demonstrated boundary escape on accepted model input. Direct helper callers must catch an invalid query.

Callback index, each pure under 3.6 Requires:
- **3.7 :45** maps full-state taskRow; establishes the copied/derived row list.
- **3.8 :54** filters nonterminal rows into open.
- **3.9 :56** sorts open by in_progress/ready/blocked priority, then numeric ID.
- **3.10 :60** filters terminal rows into ended.
- **3.11 :61** compares ended via closedOrder.
- **3.12 :68** tests exact derived status for the single explicit class.

Filter initiation/maintenance/termination: no selected items initially; after k source rows output contains exactly satisfying first-k rows in source order; next row either appends or not; finite source length. Sort compares only copied row arrays; its postcondition is comparator order, with no externally supplied callback. Example [blocked #3, ready #2, in_progress #1] maps three full-graph rows, filters all three open, sorts to [1,2,3]. Default ended slice never changes complete state.

**3.13 formatTaskRows, :71.** Requires derived rows with valid task text/reason and numeric blockers. Empty yields “No tasks”; otherwise format each row, include blockers suffix when nonempty, join with newlines. Ensures text and selected row set agree, full graph is not reclassified. E is pure but not caught here. formatTaskContent trims expireReason only for expired records; state validator/transform callers establish string-or-undefined. No ordinary formatting fault was demonstrated under V(S); do not claim arbitrary malformed records are valid controller input.

**3.14 row formatter, :74.** Branch on blockers length, format task content, emit one row. **3.15 blocker mapper, :76.** Number → `#ID`; after three blockers suffix fragments are #1, #1/#2, #1/#2/#3. Both only build local strings. A future error result must not reuse this formatting path if that very path failed.

### 4. batch.ts — 5 bodies

**4.1 terminalEdgeNotice, :4.** Requires a candidate full state and numeric dependent/prerequisite; successful-edge callers guarantee the edge exists. Find prerequisite; terminal branch explicitly says already done/expired, already satisfied, blocking unchanged; other branch says edge added. It does not add the edge. Ensures truthful notice under caller precondition, no mutation. **4.2 find predicate, :9:** ID equality, pure.

**4.3 createTaskBatch, :13.** Requires V(S), a PRIVATE disposable mutable candidate, and shape-checked creation items. It is intentionally a mutating helper, not a controller publication boundary. First snapshot existing IDs and initialize keys/created/outcomes empty. Creation loop rejects blank text, blank/duplicate accepted key, or exhausted ID space before reserving an item ID. Successful item increments nextId, appends pending record, binds exact key, records creation. Second pass resolves string aliases against accepted keys and numbers ONLY against pre-call existing IDs; never guesses newly assigned numeric IDs. For each reference, executeUpdateDeps validates a full replacement dependency list before accepted edge mutation; error records edge_skipped and leaves previously accepted edges intact. Terminal accepted edges use terminalEdgeNotice. Final pass attempts requested starts only after all dependencies, records started/start_skipped. Ensures deterministic semantic best effort and truthful ordered outcomes, not atomic scalar semantics. E may leave this PRIVATE candidate partially transformed; executeTaskRequest does not return/install it when it throws. Scalar rollback is handled at the enclosing executor.

**4.4 existing-ID mapper, :18.** Establishes the immutable set of IDs present before creation. **4.5 created-task find predicate, :67.** Locates the created ID in candidate. Under V(S) and this helper's only mutations (append/update/start, never delete), the “Created task missing” Error is unreachable. It is not a proven harness crash.

Loop proof and k=3 trace:
- Creation invariant: after k input items, created contains exactly acceptable prefix items in original order, each with one unique assigned ID; keys contains only accepted bindings; rejected items consumed no ID; V(candidate) holds. Initialize empty accumulators; validation before increment maintains invariant; finite item count terminates. Three accepted items A(key a), B(key b), C give nextId 1→2→3→4 and created [1]→[1,2]→[1,2,3]. If middle item duplicates a, trace is [1], [1], [1,2] and the earlier a binding remains.
- Edge invariant: after each reference, the graph is reciprocal/acyclic and contains exactly previously accepted edges plus accepted requests so far; every visited edge has an outcome. Created outer loop and finite blockedBy inner loops advance monotonically. Example A→B, B→A, C→missing999: first accepts 1.blockedBy=[2]/2.blocks=[1]; second rejects cycle, graph unchanged; third rejects unknown pre-call ID, graph unchanged. This is the three edge-iteration trace exercised in P10. Missing refs/self/duplicates/invalid numbers/closing cycles are business failures, not throws.
- Start invariant: all edge processing is complete before any start. After k created items, each requested start in that prefix has exactly one outcome; unrequested items stay pending. Three-item trace with all requesting start: #1 remains blocked, #2 becomes in_progress, independent #3 becomes in_progress. Dependencies are not altered by starts; finite created length terminates.

### 5. execute.ts — 10 bodies

**5.1 finish, :18.** Requires a valid complete candidate, coherent changed/error/outcomes, optional preselected rows. If rows absent, derive every row from full state; compute partial from skipped item/edge/start. Error text wins over list/mutation formatting. List uses selected rows; mutation text says Partially applied only if changed and skips, Nothing applied when skips with no effect, otherwise joined notices or Task updated. Return complete state plus selected copied details/tasks/rows and nextId/outcomes/partial/error. Ensures full-state/view separation. It does NOT persist, set native isError, or shield itself from formatting errors. E leaves caller previous state untouched when called on a clone. Calling this rich formatter as a fallback after a classification failure would not be a safe recovery strategy; that is a repair constraint, not a separate observed current fault under V(S).

Callback index:
- **5.2 :27** full-state taskRow mapper (only if no rows supplied).
- **5.3 :29** some predicate for skipped_item/edge_skipped/start_skipped; monotone existential, short-circuits on first match.
- **5.4 :38** outcome-message mapper; one string per outcome in existing order.
- **5.5 :46** extracts copied row.task into details.tasks.
Each is pure under finish's precondition and has the standard prefix accumulation or existential invariant. For outcomes [created,edge_added,start_skipped], partial after examined prefixes is false,false,true.

**5.6 executeTaskRequest, :56.** Requires V(previous); input is unknown. Strongest postconditions by sequence/branch:
1. Try parse only. Rejected shape/combination yields cloned previous, changed=false, details.error via finish. This includes model clear/modify; no persistence or source writes. Catch uses locally thrown parser Error.message for ordinary JSON input. Invalid parser helper input alone is not an unhandled failure.
2. On parse success clone previous. Every subsequent graph/lifecycle mutation is restricted to this clone.
3. List: select rows against full clone and return changed=false; hidden state preserved.
4. Add: createTaskBatch on clone; find first skip. Scalar + any skip discards candidate and returns a fresh previous clone/error/changed=false/no creation. Batch retains all accepted effects and reports skips; changed iff nextId changed (every accepted item increments it, rejected items do not). All-rejected batch has no publication, says Nothing applied rather than partial success. Candidate IDs of an uncommitted rejected scalar are not externally issued and need not reserve controller high-water.
5. Start: existing executeStart either returns details.error without mutation or sets pending-unblocked→in_progress; finish marks changed exactly when no error.
6. Done/expire: first compute maximum closedOrder over full candidate, reject exhaustion before lifecycle mutation; call existing helper. Error returns unchanged candidate/changed=false. Success finds same ID (helper never removes tasks), assigns max+1, returns changed=true with explicit status text. The missing-closed-task Error is unreachable under these helper contracts. Existing semantics allow repeated terminal transitions; no new prohibition is imposed here.
7. update_deps: copy requested arrays before reusable helper; a business error returns changed=false. On success inspect full state, emit notices for newly added incoming edges, and demote affected in-progress dependents with blockers to pending. Affected means requested task or changed incoming dependencies; removing blockers does not automatically start a task. Return changed=true, one candidate; no persistence here.
8. E after the narrow parse try propagates, but previous remains unchanged; a partial candidate is never returned. No routine transform callback failure was demonstrated under V(S), because helpers here are closed pure/local operations. M1 is the reachable external-persistence boundary gap, not an assertion that every helper needs catches.

Callback index:
- **5.7 :89** first-skip find predicate for scalar/all-batch reporting; pure.
- **5.8 :150** closed-task ID equality lookup; existence established by successful helper.
- **5.9 :172** finds corresponding previous task for comparison; unique IDs establish at most one.
- **5.10 :184** tests any newly introduced blockedBy member against previous; the preceding `before &&` establishes before is defined.

Loop proof: closure scan starts max=0, after k tasks max is max(0,first k orders), next Math.max preserves it, finite tasks terminates; representative [closedOrder2, absent, closedOrder5] gives 2,2,5, then assigned 6. Dependency postpass starts no outcomes and no demotions; after k tasks all new incoming edges for prefix tasks are reported and each affected running blocked prefix task is pending. Graph edges are not changed by this postpass, so readiness checks cannot invalidate previous classifications. Nested prerequisite loop enumerates finite edges and appends only newly accepted ones. Three-task trace: #1 pending prerequisite, #2 running/newly blocked by #1, #3 running/unchanged with no blockers → after #1 no status change, after #2 pending with edge_added+blocked notices, after #3 still in_progress. Current graph vs previous lookup is over complete arrays, never list details.

### 6. human-command.ts — 5 bodies

**6.1 tokenize, :19.** Requires the string AFTER /task. Local tokens=[], value='', active/literal=false, quote=''. Each character: backslash outside single quote consumes the next literal char or throws trailing escape; inside quote closes matching quote or appends character; opening quote marks literal/active; whitespace flushes active token and resets; other chars append and activate. End with open quote throws; otherwise flush active token. Ensures exact D7 token values and literal markers (including empty quoted value), or syntax Error before any task mutation. Finite index increases at least one character each iteration, two for escape. Prefix invariant: tokens are all completed words before current raw word, value is decoded current word, quote records only unfinished quoting. Three-character trace for `a b`: after a value='a', active=true; after space tokens=['a'], value=''; after b value='b'; final flush ['a','b']. For `'a'`: open single quote/empty literal, append a, close quote, final token a. No fictitious three iterations are needed for a one-character trailing-backslash error.

**6.2 number, :50.** Requires string plus optional zero flag. Regex establishes canonical positive decimal, or canonical nonnegative when zero=true; Number conversion followed by safe-integer check. Ensures safe integer, rejects signs/leading zero/exponent/hex/fraction/unsafe magnitudes. No state effects. Errors contained by outer human execution parser envelope.

**6.3 text, :57.** Requires string; reject blank trim, otherwise return original untrimmed text. Ensures nonblank but preserves user's accepted spelling/whitespace. Pure Error exit.

**6.4 parseHumanTaskCommand, :61.** Tokenize fully first. Shift exact supported root or throw; add/modify require one positional non-flag-looking unquoted token; determine allowed flags. Scan rest: reject unknown/misplaced/duplicate flags; --start is boolean; all others require a value (quoted/escaped flag-looking values allowed). Map blocked-by absent→undefined, quoted empty→[], otherwise canonical comma IDs. Branch clear returns; list builds checked model list and validates limit/type; add returns checked nonblank positional with optional start/deps; modify requires options, accepted lifecycle status only, reason iff expired and nonblank, checked ID/text. Ensures one complete typed command or Error with no writes. Execution validation, not completion, owns graph/lifecycle correctness. Bare/help/show/info deliberately reject here; future routing must preserve their legacy handler.

**6.5 dependency-ID mapper, :102.** Applies 6.2 to each comma token. No accepted partial ID list is returned after failure. Prefix invariant output is checked IDs of processed prefix; [1,2,3] gives [1]→[1,2]→[1,2,3]. Duplicate numbers survive syntax parsing intentionally and are rejected atomically by graph validation later.

Options-loop invariant: after each consumed flag/value pair, options contains exactly validated distinct options in prefix; no task mutation. --start advances one, other flags advance two. Example `modify 1 --text x --blocked-by 2,3 --status done`: after iterations map contains text; then text/deps; then text/deps/status. Finite token length terminates, missing final value throws. Control branches fully partition the four allowed roots.

### 7. human-execute.ts — 5 bodies

**7.1 finish, :15.** Requires V(candidate), modify/clear, message/error/outcomes. Derive full copied rows and details; changed=!error; errors explicitly say no changes applied. Ensures a human operation value with complete state. E leaves caller previous unchanged, but rich row/error formatting is not a generic safe fallback for an arbitrary earlier failure.

**7.2 :22** taskRow mapper on full state; **7.3 :35** row.task extraction. Both pure with finite prefix-copy invariants; classification exceptions propagate to finish's caller.

**7.4 executeHumanTaskCommand, :45.** Requires V(previous), actual string args. Parse try catches syntax/business parameter failures into unchanged clone/error; add/list reuse scalar model executor; clear returns empty state with same nextId. Modify clones, looks up target, returns no-effect error if absent. Text updates only candidate text/updatedAt; constructs dependency request first and lifecycle request second regardless of textual option order. For each suboperation, error discards every candidate change and finishes a fresh previous clone; success adopts operation.state and accumulates outcomes/text. Final success returns one combined candidate. Ensures all-or-error publication semantics when controller commits only final success. E during any transform leaves previous unchanged and returns no partial candidate; it is not caught by this function except during parsing.

**7.5 target find, :69.** Pure ID equality; existence branch establishes target for later updates. After a subrequest clones again, stale local target is not reused for more writes.

Loop proof: requests has cardinality 0,1,or2, never three. Initiation state includes only optional candidate text edit. Maintenance either discards everything on error or replaces state with the entire validated next candidate and accumulates corresponding messages. Termination at at most two iterations. Representative maximum trace: initial text edit; iteration1 valid dependencies and possible demotion; iteration2 lifecycle start rejects blockers → return original text/dependencies/status, no outcomes, changed=false. Success counterpart deps unblock then start gives changed candidate with text/deps/in_progress. Inner content loop appends only text blocks; current executor emits one text block per suboperation, so no invented k=3 trace. Persistence/notification is not performed here; session.executeHuman is M1's boundary.

### 8. state.ts — 4 bodies

**8.1 parseTaskState, :6.** Requires unknown ordinary persisted entry data. First reused validator returns detached valid legacy state or undefined; reject absent base or unsafe nextId; guard raw tasks array. Loop over parsed records: reject unsafe ID/edge numbers; inspect same-index raw object; if closedOrder present and defined, require safe-positive number then add it to detached record. Final state has all legacy graph constraints plus safe-number and preserved closure-order constraints. Invalid ordinary stored data returns undefined, does not throw, and never mutates raw history. E from exceptional accessor/iteration behavior is possible for non-JSON objects, but native persisted JSON/plain snapshots establish ordinary-data precondition; do not demand universal proxy safety in this private parser.

**8.2 unsafe-edge some predicate, :22.** Tests !Number.isSafeInteger on copied edge list. Pure existential. Three edges [1,2,3] produce false through three checks; invalid third produces true and parser returns undefined. No publication.

Parse loop invariant: base graph remains valid; processed prefix has copied valid closure orders, remaining records remain valid legacy records; no source write. Three records with orders [4,undefined,6] yield copied orders [4], [4,undefined], [4,undefined,6]. An invalid third rejects the WHOLE snapshot, not a partially decorated state. Finite task length terminates.

**8.3 restoreTaskState, :40.** Requires branch in chronological root→leaf order, complete same-owner history, and safe-positive highWater. Explicitly rejects invalid highWater. Start empty tasks at highWater; branch loop ignores nonmatching entries, parses matching ones, and selects last VALID matching snapshot. History loop folds maximum valid nextId across all branches plus highWater/current snapshot. Final clone of chosen tasks with folded nextId establishes documented branch contents and allocation floor; no input mutation. Invalid snapshots are skipped under the existing accepted latest-valid-snapshot semantics, not a newly discovered restoration failure. E before return publishes nothing; session.restore's assignment is not executed. The function cannot catch exceptions thrown while its argument expressions are being evaluated; O1 records that required future envelope.

Loop invariants: branch processed-prefix state is the last valid matching snapshot, or initial empty if none. History processed-prefix nextId is the maximum of original floor, chosen branch nextId, valid history nextIds so far. Three branch snapshots [A next2, invalid, B next4] select A,A,B; three history floors [2,8,4] with H=5 fold 5,8,8. Finite arrays terminate. Clearing snapshots with high nextId still reserve history; restoration of an older branch does not lower H. Fork uses a distinct controller namespace, not a global allocator.

**8.4 clearTaskState, :63.** Requires V(S); returns empty tasks with same nextId, does not mutate S. Ensures no ID reset, no I/O.

### 9. session.ts — 7 bodies

**9.1 createTaskSession, :7.** Requires valid initial state (default empty), different controllers for different actual session identities; initial state is not an unknown-data ingestion API. Clone initial before returning methods. Ensures private detached state and H=initial.nextId; no shared global counter or I/O. Constructor errors propagate before a controller is returned; initialization caller envelope is O1. The enclosing function plus the six bodies below total seven.

**9.2 commit, :11.** Requires valid candidate, synchronous non-reentrant persist; callers generate next.nextId≥current H. Sequence NSP: first state.nextId=max(old,next), while old tasks are intact; second clone candidate for persist so callback mutation cannot alter candidate/controller; if callback throws, old tasks remain with reserved floor and external persistence may have happened; if it returns, clone next into private state. Ensures one persistence invocation and detached published state on success; no record publication on persistence exception, no compensation or retry. E between reserve and publication preserves old records. For valid plain data clone has no ordinary user callback; post-persist cloning may allocate but engine/allocation failure is outside the promised guarantee. Synchronous/non-reentrant is essential: accepting promises or reentering mutations would defeat the commit order and is expressly not this API's contract.

**9.3 returned snapshot arrow, :21.** Requires controller initialized; returns detached clone, no I/O. It is a read helper, not inherently a failure result constructor. Caller using it after another fault must not silently assume all future snapshot readers are infallible.

**9.4 returned restore, :22.** Evaluate restoreTaskState completely, then assign. On success branch state and H established; on E old state—including H—unchanged. Return void currently gives no typed restoration failure; reader evaluation occurs outside this method. No additional mutation during scan. O1, not a claim of a current deployed unsafe listener.

**9.5 returned execute, :28.** Transform private current state without mutation; changed=false returns operation without calling persist; changed=true commit once then return operation. On persistence E, old records/higher floor remain, operation is not returned, and exception escapes (M1). On transform E, private state unchanged. Returned operation/state/details are independent of private published state because commit clones. Normal batch semantics unchanged.

**9.6 returned executeHuman, :33.** Identical publication proof using combined human executor: error/list do not persist; successful modify/clear/add persists once; exceptions escape with the same state guarantees. Human clear on already-empty state still follows accepted successful clear operation semantics; no new no-op policy is imposed.

**9.7 returned clear, :38.** Produce empty candidate at H, commit once, then return clone. Failure before install retains old tasks/H; success empties tasks without lowering H. E currently propagates rather than typed failure (M1). This human/internal method does not expose model clear.

There is no loop in session.ts. Sequence traces across three calls are NOT presented as loop proofs: fail add #1 reserves2/old tasks; success add assigns#2/next3; clear retains3. P1 directly observes this behavior.

### 10. admission.ts — 3 bodies

**10.1 taskAdmission, :5.** Requires tool name plus reader, not pre-read tasks. Exact task branch returns undefined without evaluating reader. Otherwise read full tasks once; existential test permits iff any in_progress task has zero full-graph blockers; if none return explicit block/reason without terminate. Ensures correct admission on normal valid reads; E from read/classification escapes unchanged state (M2), violating the newly required failure postcondition but not demonstrated native fail-open.

**10.2 some predicate, :13.** Short-circuit status test means pending/terminal tasks need not be classified; in_progress uses taskRow on full graph. Prefix invariant: no qualifying task seen until first success; successful return witnesses an active unblocked task. Three tasks [ready,blocked-in_progress,unblocked-in_progress] give false,false,true. Read/classify writes no records.

**10.3 taskAvailabilityProblem, :25.** Requires finite string name array from actual registry/active tools. Includes exact task→undefined, otherwise explicit configuration diagnostic. No override/activation side effect. This helper does not inspect profiles or prove callable tools; O4/N5 concern real integration.

### 11. tool-definition.ts — 2 bodies

**11.1 createTaskToolDefinition, :36.** Requires synchronous run(input,context) returning a TaskOperation after any commit. Returns unregistered data with task name, allowed flat schema, sequential metadata, and execute. No registration, I/O, runtime scheduling, or state captured except run. Flat schema deliberately permits some combinations subsequently rejected by parseTaskRequest. Source/built metadata distinction N4 applies.

**11.2 returned async execute, :47.** On call, evaluate run(input,context), then property .result, then resolve promise. Success returns exactly run's result; ordinary sync run throw becomes rejection; no awaitable-run contract is declared and no async persistence support is inferred. Native framework accepts an async tool execute and catches its rejection; plugin itself does not contain it (M1). It does not inspect details.error, issue notifications, or use signal/update callbacks. Do not “fix” native error flags by adding an unsupported isError property; N2 gives actual source behavior. A thrown helper alone would not prove harness crash here.

### 12. human-completion-input.ts — 7 bodies

**12.1 tokens, :10.** Requires ordinary editor text, valid starting offset. Tolerant lexer uses same quote/escape decoding as D7 but retains unfinished quotes/escape and raw start/end spans. Outer whitespace branch increments index; nonwhitespace opens a word; inner loop consumes at least one char, consumes two for escape, or stops on separating whitespace/EOF; append decoded word with complete flag. Ensures ordered nonoverlapping token spans and literal/complete metadata, no writes to text. Unlike execution tokenize, unfinished input is not an error.

Nested-loop invariant: result covers all preceding words, index is next raw unread position; inner value is decoded prefix of current word and quote/escapedEnd describe exact incomplete state. Outer progress follows inner consumed word or whitespace. Three-char trace `a b`: word a ends at1, whitespace advances to2, word b ends at3. For unfinished `"ab`, inner steps open quote, append a, append b; complete=false, span ends at3. Finite input terminates.

**12.2 taskCompletionInput, :65.** Requires native editor's string[] and integer cursor coordinates. Invalid bounds return undefined before indexing an invalid line; join lines, reduce preceding line lengths to absolute cursor. Exact /task followed by whitespace and cursor after head required; otherwise delegate context. Tokenize full text; locate token containing cursor inclusively; if none, insert zero-width virtual token at correct position. Reject context when any prior token incomplete. Decode raw prefix with tolerant tokens and return complete input context. Ensures suffix token span is available for whole-token replacement, absolute cursor corresponds to native coordinates, no editor mutation.

Callback index:
- **12.3 :80** reduce (size,line) adds line.length+1, seeded with cursorCol. With preceding line lengths [3,4,2], seed2 yields 6,11,14 (three-line prefix); invariant cumulative prior lengths/newlines plus original column.
- **12.4 :85** findIndex of containing token (`start≤cursor≤end`).
- **12.5 :88** first token starting after cursor if no containing token.
- **12.6 :99** some incomplete prior token. Each pure with finite search prefix/first-match or existential invariant.

**12.7 insertTaskCompletion, :105.** Requires valid CompletionInput and a canonical choice from choices (no quotes/newlines in choice). Inspect opening raw char; retain simple quote style and close it, otherwise plain value. Replace WHOLE token and preserve raw prefix/suffix around it. Add separator unless suffix begins whitespace; cursor moves after replacement and one separator (existing or added). Split text and preceding cursor segment to recover lines/coordinates. Ensures only token replacement and required separator, surrounding text/following arguments retained, no original lines mutation. This pure function need not validate free-form provider items: applyCompletion verifies membership first. E propagates to its current uncontained caller; C1 requires containment there.

### 13. human-completion-context.ts — 6 bodies

**13.1 legacySlot, :20.** Requires previous token list and optional fixed extras. Call reused completeTaskArgument; null becomes no legacy candidates. Return loose fixed values plus new roots and descriptions. No reader/I/O. Legacy helper uses module-owned constant arrays for root/show candidates, so this call has no external callback failure under its precondition.

**13.2 :25** candidate→value; **13.3 :27** candidate→[value,description]. Pure, standard prefix map invariants. Object.fromEntries contains only fixed legacy keys, not arbitrary user-created aliases.

**13.4 valueSlot, :32.** Requires known option/action and CompletionInput. --status→three lifecycle values; --type→seven list values; --blocked-by→ID slot including numeric modify-self, or no self for add; free text/reason/limit→undefined. Ensures no speculation about actual graph validity or arbitrary numeric limit values. Number(self) is completion assistance only; actual human parser still validates canonical IDs. No reader here.

**13.5 taskCompletionSlot, :61.** Requires valid CompletionInput. At root, literal token delegates; otherwise legacy roots+new roots. At unquoted show argument, legacy on/off. Unknown/literal action delegates. For modify positional ID return ID slot; add text delegates. Scan preceding flags to ensure context is parsable: valid --start consumes one; valued option at current token delegates to valueSlot; absent/flag-looking unquoted missing value or invalid previous option delegates. Literal current option delegates. Then collect recognized used flags throughout tokens (skip values), excluding current token; return unused fixed flags. Ensures no mutation, no reader, contextual ownership only. Completion does not supersede execution validation.

**13.6 :99** unused-flag filter (`!used.has(flag)`). Pure finite predicate; after k flags output is exactly unused prefix flags.

Loop proof: first scan starts at first option position; processed prefix consists of syntactically valid options with their values, position advances one for --start, two for valued option, or returns; cannot stall. Second scan's used set is recognized option names outside current slot among visited tokens; valuated options skip next token to avoid treating literal values as options. Finite tokens terminate. k=3 example `modify 1 --text x --blocked-by 2 --status done --`: preceding scan positions2→4→6→8, after three iterations all three option/value pairs accepted; used collection obtains --text, then --blocked-by, then --status; current flag suggestions contain only --reason. For clear's zero permitted flags there is no fabricated three-flag trace.

### 14. human-completion.ts — 12 AST bodies plus one referenced predicate

**14.1 looseMatch, :17.** Requires query/value strings; values are canonical lowercase fixed choices. position starts0; for each lowercased query character, find at/after position; absent→false, present→position+1. Ensures subsequence match, pure. Invariant processed query prefix is a subsequence ending before position. Query `sow`, value `show`: positions1,3,4 after three characters, true. Finite query length terminates.

**14.2 choices, :27.** Requires valid input/slot and current-session reader returning task data when successful. Fixed slot: lowercase query; filter loose or prefix, prefix-first stable sort, map value/label/optional description. No task read. ID slot: read once; for dependencies, split head/query/tail around current comma component using decoded prefix/token; build selected IDs from head+tail; filter out self/selected IDs and require canonical numeric ID string prefix; map replacement values retaining both comma neighbors. Ensures terminal IDs included and live read on every invocation, no graph validation or state mutation. Reader/classification E propagates; no fallback authoritative [] is created.

Callbacks/predicate index:
- **14.3 :35** fixed-value filter via looseMatch or startsWith.
- **14.4 :38** comparator promotes actual prefix matches; ties retain original native stable order.
- **14.5 :39** value→AutocompleteItem.
- **14.B :56** referenced built-in Boolean filter removes empty comma components; it is not a locally defined AST body. String `''` drops; other components retained verbatim for selected-ID matching.
- **14.6 :59** task filter excludes self and selected IDs, then numeric prefix-matches.
- **14.7 :64** task→item with head+ID+tail replacement, ID label, status/text description.
All pure under choices Requires; callback exceptions propagate to its caller. Filter prefix proof as §3.6. Three tasks IDs [1,2,3], self=2, already-selected=1, query='' yields [] after1, [] after2, [3] after3. Finite arrays terminate, no caching/allocation of new task IDs.

**14.8 createHumanTaskCompletionProvider, :71.** Requires actual delegated provider and current-session reader; returns methods closing over them, no eager read, registration, mutation, or persistence. Lifecycle owner freshness is caller obligation O2.

**14.9 returned getSuggestions, :76.** Parse input/context; if unowned delegate once with original arguments/options; if owned and aborted return null without choices/read; otherwise choices then nonempty suggestions or null. Normal Ensures correct ownership/delegation and fresh read for ID slots. Async normal return adopts delegated promise, including its rejection. E from parser/slot/read/delegate turns into rejection instead of null (C1). Cancellation is checked after ownership; the delegate gets the original signal for unowned input. No blanket cancellation redesign is required.

**14.10 returned applyCompletion, :85.** Parse input/context; unowned delegates once synchronously. Owned recomputes choices (fresh read) before verifying prefix/item. If stale prefix or disappeared ID, return copied original lines/same cursor; otherwise insert canonical selected item. Ensures no stale task ID insertion and normal no-op for invalid selection. E from read/delegate/insertion escapes; current code has no exception fallback (C1). Read occurs even for a stale prefix because of actual evaluation order; a repair must contain that real order, not assume prefix check already protected it.

**14.11 candidate some predicate, :99.** Tests value equality only; prefix check short-circuits the some call when mismatched, but choices already ran. Pure existential over current choices.

**14.12 returned shouldTriggerFileCompletion, :105.** Owned slot returns true without reading tasks; otherwise invoke optional delegated trigger and default true only if it returns nullish/is absent. Does not catch a delegate throw (C1). No asynchronous trigger contract is supported; do not invent awaiting or retries for this method.

### Inventory reconciliation

AST body counts by file: admission 3; batch 5; execute 10; human-command 5; human-completion-context 6; human-completion-input 7; human-completion 12; human-execute 5; list 15; model 2; schema 2; session 7; state **4**; tool-definition 2 = **85**. `model.ts` also contains types/interfaces only; schema/tool schema declarations without callbacks are data construction, not omitted functions. The explicitly indexed built-in Boolean predicate is additional to 85. Loops inside dependencies and native callers are covered next, rather than pretending they are task-system bodies.

## Reused dependency proof and effects

### task-actions.ts

Read in full. `ok`/`err` construct textual/native-shaped results with shallow copied task arrays and optional details.error. They do not persist and do not set native isError. These results are only intermediate values for the dormant executor; it constructs detached final rows/state.

- `executeStart`: find ID; reject missing/nonpending before any write; `isUnblocked` must pass; otherwise build blockers error. Success writes status/expireReason/updatedAt on candidate only. `isUnblocked` treats missing references as satisfied, whereas taskRow treats them as blockers. This is NOT a violation under V(S): parsed/created graphs reference existing IDs. Admission independently uses conservative taskRow for a failed/missing dependency classification. Do not weaken the V(S) precondition or silently substitute filtered arrays.
- `executeDoneOrExpire`: reject missing ID/task/reason before mutation. Expire trims reason; done clears reason; both set status/updatedAt. It does not remove records or assign closure order. Dormant caller establishes closure counter before call and adds it afterward. Existing repeated terminal transitions remain accepted.
- `executeUpdateDeps`: validate ID/existence/duplicate lists, missing references and self-edges BEFORE writing task records. Construct proposed blockedBy adjacency; remove old outgoing reverse edges, install target's proposed prerequisites, add new outgoing reverses; BFS checks whether target reachable from itself. Business rejection therefore leaves even the candidate graph unchanged. Only after valid proposed graph remove actual reverses, assign both arrays/time, add reciprocals. Dormant callers pass a private candidate and copied request arrays; no shared published graph is modified.
- `hasDuplicates`: Set size comparison, pure. Old executeList/executeAdd/executeClear were read, but are NOT called by the dormant modules. In particular the old clear's nextId reset is not inherited.

Loop arguments for graph helper: validation loops preserve no-write invariant and grow checked prefix; adjacency construction after k tasks contains independent copies for k IDs; reverse-edge removal/addition after k neighbors updates precisely those neighbors. Three incoming IDs [1,2,3] for target4: validation passes first1, then1/2, then1/2/3 without writes; after accepted mutation reverses are 1.blocks=[4], then also2.blocks=[4], then also3.blocks=[4], with 4.blockedBy=[1,2,3]. BFS initiates queue=target prerequisites, visited empty; each first visit marks a finite existing vertex and appends finite neighbors; duplicate visits remove queue entries without expansion. At most finitely many first-visit expansions, then queue drains. Target reachability rejects before commit. Example chain 4→3→2→1 yields dequeue states visited{3}/queue[2], {3,2}/[1], {3,2,1}/[], success. A 1→4 edge instead eventually dequeues4 and rejects. No recursive traversal/stack depth is involved in this graph algorithm.

### task-dependencies.ts and task-format.ts

Read in full. `isUnblocked` and its every/find callbacks inspect prerequisites; `findNewlyUnblocked` is not used by dormant operations. `formatTaskContent` returns ordinary text or expired text with trimmed reason/default “no reason”; string-or-undefined reason is established by state validator/actions. Legacy statusTag/formatTaskList are not used to reclassify filtered dormant views. Their missing-reference behavior therefore cannot justify treating filtered result.details.tasks as authoritative.

### task-state-entry.ts

Read in full, including every helper. `validateTaskStateEntryData` requires unknown persisted data, rejects shape/nextId/task parse/duplicate IDs, computes max ID, checks referenced existing nonself edges, reciprocity, cycles, then returns detached records. `parseTask` establishes strings, stored statuses, integer positive IDs/edge lists, finite integer nonnegative timestamps with updatedAt≥createdAt and optional string reason. It deliberately drops unknown fields; dormant parseTaskState reattaches checked closedOrder from original aligned records. Helpers isRecord/isTaskStatus/isNumberArray/isTimestamp are the runtime guards; no hidden callback I/O. `cloneTasks` is old-record copying, not the dormant closedOrder restoration API.

Validation-loop invariant: accepted prefix contains individually valid unique IDs; first invalid/duplicate returns undefined before any source write. After three records IDs1/2/3, ids grows {1}, {1,2}, {1,2,3}; nextId must exceed3. Existing-reference nested loop checks every incoming/outgoing endpoint before reciprocity lookup. Reciprocal loop checks both directions against a byId map. Per-task BFS in hasDependencyCycle has the same finite first-visit/queue argument as above; queue spread can have ordinary JS resource bounds, but no arbitrary cap is demanded and no resource-failure process probe was performed. Finite-resource assumptions do not excuse the actual callback faults demonstrated in C1/M1/M2.

### commands/task-completion.ts

Read in full. Only `completeTaskArgument` is reused at runtime by the dormant context module; it returns constant root/show candidates or null with no task read, persistence, or delegate callback. Its exported TaskAutocompleteProvider type adds the synchronous trigger method to the installed provider type. The old provider implementation is not a containment layer around the new provider and cannot be relied upon for failure recovery.

## Native-boundary assumption registry

Relevant Pi docs were read in full before relying on their contracts: `packages/coding-agent/docs/extensions.md` (all 3023 lines), `tui.md` (961), `sdk.md` (1224), `sessions.md` (145), and `session-format.md` (438). Source takes precedence for implementation effects. No active host, provider, scheduler, or terminal was launched.

| ID | Contract/assumption | Verified source/function and consequence | Status |
|---|---|---|---|
| N1 | Plugin callbacks receive current session context; stale captured contexts can throw. | `coding-agent/src/core/extensions/runner.ts:createContext` (:724 onward) exposes getters that call assertActive; invalidate/assertActive (:593–605) reject stale use. SDK/extensions lifecycle docs require re-binding after replacement. Raw SessionManager objects captured earlier remain caller responsibility. | Source verified; future lifecycle wiring not applied. |
| N2 | Tool throw/rejection vs error flag. | `agent/src/agent-loop.ts:prepareToolCall` (:584 onward) and executePreparedToolCall (:673 onward) catch ordinary errors; successful return always has native isError=false, catch builds error result/isError=true. `agent/src/types.ts:AgentToolResult` (:362) has no isError return field. Extensions docs explicitly say returned properties do not set it. Workspace built agent-loop.js shows same distinction. | Native catches ordinary Error; NOT proof the plugin meets new local containment. Do not promise isError=true merely by returning `{isError:true}`. Existing explicit task details.error/text semantics are not reclassified as a newly invented functional bug. |
| N3 | Throwing tool_call gate blocks rather than silently admits. | `coding-agent/src/core/agent-session.ts:_installAgentToolHooks` (:486–505) awaits runner.emitToolCall and rethrows/normalizes; runner.emitToolCall (:982) awaits handlers without catch; agent prepareToolCall catches and produces immediate error, or uses block result directly. | Source and built runner/core checked. M2 is missing explicit plugin refusal, not demonstrated native fail-open. |
| N4 | Sequential tool metadata is actually forwarded/honored. | Source `coding-agent/src/core/tools/tool-definition-wrapper.ts:wrapToolDefinition` copies executionMode; source `agent/src/agent-loop.ts:executeToolCalls` (:418–424) chooses sequential for any called sequential tool. Workspace **built** wrapper.js omits executionMode; built agent-loop lacks that per-tool selection. | Unresolved deployment prerequisite. Metadata direct tests are insufficient; no activation authorized. |
| N5 | Hard tool allowlists cannot be bypassed by enabling task. | `coding-agent/src/core/sdk.ts` derives allowedToolNames from options.tools; `agent-session.ts:_refreshToolRegistry` (:2671 onward) filters built/custom/extension definitions with allowed/excluded name predicate before registration. | Source verified; actual child profiles/registry acceptance still future. |
| N6 | Native persistence can change memory before throwing. | `coding-agent/src/core/session-manager.ts:_appendEntry` (:1058) pushes fileEntries, sets byId and leafId, then calls _persist. _persist (:1029) uses synchronous writes; first flush closes its descriptor in finally. appendCustomEntry (:1136) delegates here. `agent-session.ts` appendEntry adapter (:2593) appends before retrieving/emitting entry_appended. P8 confirms built memory-before-fault ordering. | Verified source and direct built in-memory fault injection; no disk rollback or guaranteed fsync inferred. |
| N7 | Restore readers and evaluation order. | SessionManager.getBranch (:1274) walks current parent links, reverses chronological path; getEntries (:1315) filters header/shallow-copies. These methods normally read memory, not disk. However context getters/reader callbacks can throw before a method taking arrays begins; JavaScript evaluates arguments left-to-right. | O1 must encompass context/owner/history access, not just restoreTaskState body. |
| N8 | Human command errors are caught by native dispatch. | `coding-agent/src/core/agent-session.ts:_tryExecuteExtensionCommand` (:1322–1347) awaits command.handler in try, catches and emits an extension error. Command-context creation occurs before handler try. `runner.ts:emitError` (:613) invokes listeners without containment. | Ordinary Error handling verified; not a general no-throw guarantee for reporter failures. M1 is not proof every failed command disables Pi. |
| N9 | Lifecycle handler exceptions can leave plugin restoration incomplete while host continues. | `coding-agent/src/core/extensions/runner.ts:emit` (:853 onward) catches per-handler failures and emits error; it cannot complete the failed handler's remaining installation/notification work. | Safe return/typed failure must be explicitly consumed by future restoration listener. |
| N10 | Native autocomplete suggestions are async, application/trigger sync. | `tui/src/autocomplete.ts:AutocompleteProvider` (:249–275); built autocomplete.d.ts agrees for async suggestions/sync apply, while source also explicitly includes optional trigger; old task interface bridges trigger. | Relevant rejected delegate promises must be awaited/caught; no unsupported async apply/trigger requirement. |
| N11 | Editor does not contain these callback failures. | `tui/src/components/editor.ts:handleInput` (:761/:782), createAutocompleteList (:2234), requestAutocomplete (:2275), startAutocompleteRequest (:2306), runAutocompleteRequest (:2351 onward). Stored previousTask awaited; new task awaited; fire-and-forget launch. Workspace built editor.js (:1740–1810) has same critical chain. | P7 proves queue poisoning on actual built method without live UI. |
| N12 | Top-level input throw is not benign component failure. | `tui/src/tui.ts:handleInput` (:1077) directly invokes focused component; `coding-agent/src/modes/interactive/interactive-mode.ts:uncaughtCrash` (:4014 onward) restores terminal best effort then exits1; signal registration prepends uncaughtException handler (:4076). | Source trace, not live process-crash test; global installed executable not inspected/claimed. |
| N13 | Notification/logging is not intrinsically infallible. | Existing `tools/task.ts:notifyChange` catches onTaskChange but formats/logs in catch; `commands/task.ts:appendOutput` performs another pi.appendEntry; native append can fail. runner.emitError directly calls listeners. | Future task result must distinguish committed mutation from failed presentation and avoid retrying the same reporter. O3. |

Version boundary: workspace `node_modules/@earendil-works/pi-agent-core`, pi-coding-agent, and pi-tui are symlinks to `packages/agent`, `packages/coding-agent`, and `packages/tui`. Their package entry points target dist; pi-tui package reports 0.84.4. Scoped task TypeScript config uses `test/task-system-source-api.ts`, which actually re-exports **built** SDK types, while mapping agent-core types to **source** types. The audit distinguishes those facts rather than describing the scoped type check as native runtime acceptance. Global/CLI-installed runtime version and active import graph were not exercised.

## Explicit remaining caller/deployment obligations

### O1 — Restore envelope must include evaluation BEFORE safe restore invocation

The current integration plan says `controller.restore(context.sessionManager.getBranch(), context.sessionManager.getEntries())`, on first stateFor and lifecycle reload, followed by snapshot/notify. Evaluation order is receiver/controller resolution, then first argument getBranch, then second getEntries, THEN restore. A throwing context getter/history reader prevents the restore body from running; P9 proves this with a throwing history expression and a restore-called flag that stays false.

Minimal required future closure: the owning operation/lifecycle envelope includes owner acquisition, both history reads, restore, and success publication/announcement. Failure must explicitly report restoration failure, not silently install/advertise an empty newly-created owner as a successful branch restore. Preserve old controller tasks and H when restoration fails; ensure downstream admission does not use an owner mistakenly labeled restored. The exact API (safe reader-taking restore or protected call site plus typed result) is a parent repair-scope decision, not authorization for a new global registry. Plain invalid historical snapshots still follow accepted latest-valid semantics; do not invent strict rejection of every old invalid snapshot. Native lifecycle catch logs but does not finish the failed restore or repair owner identity.

### O2 — Actual-session ownership and provider replacement

Create separate controllers for distinct manager/session identities; preserve controller H across same-session branch navigation; replace the owner when an identity changes and discard on shutdown. Every completion ID suggestion/application reads that actual owner anew. No startup task-array capture, global counter, cache that treats reader failure as empty, or provider reuse with stale context. Completion must contain ordinary failures even when lifecycle wiring is correct; stale contexts illustrate why catching only the parser would be insufficient.

### O3 — Publication, notification, error reporting, and native error signaling

The intended `run` sequence is owner lookup → execute/persist/publication → notify if changed → return result. Separate these phases. If append throws, old records/H rules apply and disk/native-log uncertainty must be explicit. If notification/output fails AFTER commit, tasks are already committed: do not discard or claim rollback; report committed-but-presentation-failed if an error is reported. Exactly one task-state persist and one post-success notification attempt, no retry or alternate storage. A human output entry is separate from task-state persistence and can fail independently.

Error construction should use an independent, simple safe result path, not finish(taskRow/formatTaskRows) if those operations failed, nor readTasks/notify/appendOutput again. Arbitrary thrown values need guarded normalization or a constant message; even native error paths use Error.message/String(error), so forwarding arbitrary unnormalized values is not a universal guarantee. This is a required recovery assumption, not a demonstrated defect in a private parser's locally constructed Error.

N2 means there is a real native interface distinction: explicit textual/details.error results are the existing accepted task business-error convention, but native isError=true is generated by caught execution failure or tool-result interception, not a field on AgentToolResult. A repair must state which safe interface its caller consumes and must not claim native error-flag semantics unsupported by this installed contract. The audit does NOT demand rewriting all accepted business errors into throws or installing a new native hook.

### O4 — Integration not applied and compatibility is not proven

No production task-system import/registration path was found in the scoped active runtime files. The gate, task tool replacement, human routing, provider installation, renderer selection, and child capability changes are future obligations. Keep complete state for dependencies/Boulder/compaction; list details are presentation only. Human-only clear/modify remain absent from model dispatch/schema. Source sequential support cannot compensate for the inspected built wrapper dropping executionMode. Do not activate until an authorized deployment has actual matching forwarding/scheduler support and task is callable within hard allowlists. No runtime changes or compatibility/package repairs were made here.

## Unaffected guarantees

1. Model/human parameter and business rejections with valid prior state are reported without publishing candidate changes; malformed requests are not made successful by batch tolerance.
2. Batch semantic partial success survives bad item/edge/start requests in deterministic order; terminal prerequisites remain satisfied, not rejected. Scalar add and combined human modify remain all-or-error.
3. Candidate-only transformation prevents partial task-record installation. The private batch helper's partial mutation is intentional and isolated.
4. Synchronous failed commits retain old task records and never reduce the controller allocation floor; the next successful add skips reserved IDs. Clear does not reset the floor.
5. Successful mutations persist once, and snapshot/persist/result mutation cannot alter published records. No persistence retry/storage fallback is present.
6. Restoration chooses latest valid branch snapshot and bootstraps H from valid complete owner history; no filtered view is used for persistence/graph/readiness.
7. Closure-order counter is based on full state and guarded against safe-integer exhaustion. Legacy absent orders remain readable with deterministic ID fallback.
8. Exact task admission exemption avoids the reader entirely. Other normal gate decisions require an actual in-progress, unblocked full-state task. Current native preflight also fails safe on ordinary gate throws, though M2 remains.
9. Normal completion is pure, current-session, stale-choice checked, quote/escape aware, and preserves comma neighbors/following text. The failure gap does not justify changing these accepted semantics.
10. No locks, timers, file handles, or external connections are allocated by these dormant leaf functions. Native first-flush file descriptor cleanup has finally; no leak was found in that inspected append path.

## Design Documentation Issues

### [DESIGN_DOC_OUTDATED] — The future integration recipe still prescribes the superseded failure propagation

- **Affected design sections:** `docs/task-system/integration-plan.md` Actual available APIs; §1 step6 and Persistence obligations and limits; §3 human commands; §3a reader faults. Related scoped `architecture.md` D7/D8/Implemented boundaries.
- **Documentation states:** preserve logging/rethrow; persistence exceptions propagate/report failure; completion reader faults propagate. The plan also passes already-evaluated arrays to restore and invokes notify after execute without a final safe phase contract.
- **Implementation does:** those propagation statements accurately describe the audited old leaf behavior. They do NOT satisfy the NEW exception-safety-scope §1/§5–8; architecture's opening notice acknowledges this supersession.
- **Impact:** following the plan as a future wiring recipe would reproduce C1/M1/M2 and leave O1/O3 unclosed. Minimal documentation repair, after final APIs are chosen, is to replace the recipe with actual safe interface consumption and reader/presentation envelopes, updating physical line estimates honestly. No redesign or new audit round is implied.
- **Classification:** Non-Decisional as to abandoning stale propagation instructions; final API/line estimates follow the parent's chosen repair.

`docs/ARCHITECTURE.md` was read in full. Its “Task List v0.2.0” section and appendix describe the LIVE system and point to its live contract. Because dormant integration is expressly not applied, lack of a claim that live task callbacks already implement this supplement is correct, not an outdated-code finding. A cross-reference to the dormant supplement/final integration boundary would aid discovery, but this audit does not inflate that observation into a safety violation. Similarly scoped architecture's explicit supersession banner is not concealed or treated as proof the old code complies.

## Verification

### Independent bounded probes (existing TSX config, no live providers)

Executed:

`node_modules/.bin/tsx --tsconfig my-plugins/oh-my-pi-v2/tsconfig.task-system.json my-plugins/oh-my-pi-v2/.pi/exception-hoare-probe-270c6baa.ts`

The temporary probe used assert.throws/assert.rejects and ordinary Error callbacks. Every promise was observed; no OOM, process-failure trigger, terminal, live provider, reload, or native registration was used. It imported only the dormant functions plus actual built Editor/SessionManager for isolated in-memory method checks. All ten groups passed assertions describing the current behavior, NOT contract acceptance:

| Probe | Scenario and observed result |
|---|---|
| P1 | Failed add A: throws, tasks=[],nextId=2. Next successful add B: ID2,nextId3, exactly one persistence invocation. |
| P2 | Human combined modify, clear, add faults: each throws; old #2/B/pending records unchanged; failed add raises floor to4. |
| P3 | Tool-definition execute around failed add D: rejects; old records remain, floor5. |
| P4 | Admission task+throwing reader: exempt without read. read+same reader: throws. |
| P5 | Owned `/task modify ` reader fault: suggestions reject; application throws; input array unchanged in this reader-only failure. |
| P6 | Unowned delegated suggestions: both synchronous throw and rejected promise escape; delegated apply and trigger throw. Each delegate called once (no existing retry). |
| P7 | Actual built Editor.startAutocompleteRequest on isolated receiver: first suggestion rejects, next request rejects before provider; two requests/one provider invocation. All rejections explicitly caught by the probe. |
| P8 | Actual built in-memory SessionManager.appendCustomEntry with injected _persist Error: native log contains candidate, controller retains empty tasks/floor2; restoring from its log sees that uncertain appended task. This confirms no rollback promise. |
| P9 | Throwing history argument before restore call: restore-called remains false. Demonstrates exact caller-evaluation obligation, not a live native getEntries disk failure. |
| P10 | Three-item cycle/missing-edge batch: all three created; A blocked by B, B starts, reverse cycle edge skipped, missing999 edge skipped; partial=true, source empty state unchanged. Scalar missing dependency: changed=false, original empty state returned, explicit add rejection. |

No full suite/build/root check or dependency repair was run because this was a read-only analysis. Existing focused tests were read for real caller shapes and accepted semantics, not accepted as prior proof; notably old fault assertions intentionally expect propagation and need changing only if the parent approves the necessary dormant repairs.

### Source/read coverage and preservation

- All 14 task-system TypeScript files read in full; AST function-body inventory independently generated with installed TypeScript and reconciled above.
- Reused task-actions, task-dependencies, task-state-entry, task-format, task-types, and commands/task-completion read in full; active task/command adapter and relevant framework callsites inspected to establish real evaluation and containment, not to edit them.
- Current task scope/principles/architecture and integration plan read; root ARCHITECTURE and Hoare methodology reference read. No prior worker report used as evidence.
- Protected manifest has 46 entries; all passed SHA-256 verification before AND after probes. The sole temporary probe script was removed. Final staged and unstaged diff hashes exactly matched the initial hashes below; no implementation/test/config/doc changes were made. The report itself is outside the repository.
- Initial unstaged diff SHA-256: `38344dad1c9e07cfb376ff9c944ed632d85a7d85d813c2dd5bc2600a35b6ba06`.
- Initial staged diff SHA-256: `98cad3272f6d05411851491e3f90e6e8045a278f70907f9f3773b315922d92e7`.

## Remaining proof limits and disposition

This is structural natural-language reasoning with bounded counterexamples, not exhaustive execution or a universal JavaScript no-throw proof. Correct caller-established task/state/editor shapes, finite resources, synchronous non-reentrant persistence, and session ownership remain explicit Requires. It does not infer arbitrary resource caps, promise durable disk rollback, force success on error, demand catches in every parser, or require undocumented lifecycle restrictions. No new unsafe helper input is invented solely to manufacture findings.

C1 is the concrete high-impact callback boundary defect; M1/M2 are newly required plugin boundary containment gaps whose outer native handling is distinguished from harness crashes. O1–O4 remain explicit future caller/deployment obligations. The parent decides repairs; no source/test/config/doc edits or follow-up audit round are proposed or performed by this report.

# Independent Hoare audit — explicit `done.startNext` handoff (2026-09-22)

## Scope, authority, and verdict

**Verdict: PASS for the documented handoff contract, under its established controller/state preconditions.** This is a new audit of the current `done.startNext` implementation, not an endorsement or revision of the archived before-fix report above.

The sole specifications used here are `principles.md` properties 11–12, `architecture.md` D2 and D4a, and `integration-plan.md` “Actual available APIs.” They require an optional `done.startNext: ID | ID[]`; no unnamed-ready-task selection; close/order before every named start; reuse of `executeStart`; ordered visible `started`/`start_skipped` outcomes; partial rather than top-level error for business start failures; and one synchronous publication. They explicitly reject non-empty/unique-array rules, duplicate preflight, a second start validator, transaction/precheck behavior, rollback, and new outcome/error types.

The audited source is `schema.ts:TaskRequestSchema/parseTaskRequest`, `execute.ts:executeTaskRequest/finish`, `start-next.ts:executeStartNext`, `task-actions.ts:executeStart/executeDoneOrExpire`, `session.ts:createTaskSession.publish/execute`, `tool-definition.ts:createTaskToolDefinition`, and `task.ts:registerTaskTool`. `task-system-handoff.test.ts`, generated graph coverage, transition tests, session/exception tests, and tool integration tests were read as evidence, not as the specification.

### Requires and ensures

Let **V(S)** mean the existing controller-valid complete task graph: unique safe task IDs, reciprocal existing dependency edges, valid lifecycle fields, acyclic dependencies, and an allocation floor greater than every issued ID. Let **C** be the detached candidate produced by `cloneTaskState(S)`.

**Requires.** The caller supplies ordinary JSON-like input; `parseTaskRequest` is the shape boundary. A model-facing caller uses `TaskSession.execute`, whose controller owns V(S), and supplies a synchronous, non-reentrant persistence callback. `executeStart` and `executeDoneOrExpire` retain their established helper contracts: business rejection writes no task record; a successful start changes only its pending/unblocked target; a successful close keeps the target record present. Finite ordinary arrays and ordinary `Date.now` behavior are assumed; hostile accessors/proxies and engine allocation failure are outside this task-state API contract.

**Ensures.** A malformed request, a non-`done` request carrying `startNext`, closure-order exhaustion, or failed `done` returns an unchanged detached representation of S, `changed=false`, an error, and zero handoff attempts. A successful `done` gives its target the next full-state `closedOrder`, then attempts exactly each supplied ID in normalized order on C. Each business start failure retains C at that iteration and produces `start_skipped`; each success updates C through the existing `executeStart` and produces `started`. The original input and S are not mutated. The resulting changed operation is published once or, on persistence fault, is converted to the existing non-partial persistence error with prior controller records retained and no rollback claim.

## CFG and natural strongest postconditions

### 1. Parse and candidate creation — `parseTaskRequest` then `executeTaskRequest`

1. `TaskRequestSchema` gives only the `done` union member the optional scalar-or-array field. The `additionalProperties: false` objects make `startNext` on `start`, `expire`, `list`, or any other action fail shape checking before lifecycle dispatch. Scalar IDs and every array element are positive safe integers; the array deliberately permits length zero and duplicates.
2. `parseTaskRequest` only checks and returns the original input reference; it writes neither request fields nor task state. Its error is caught by the initial `executeTaskRequest` try/catch, whose NSP is `cloneTaskState(S)`, `changed=false`, `details.error` set, and no call to any lifecycle helper.
3. On parse success, `cloneTaskState(S)` creates C before the action switch. Its task records and dependency arrays are detached. Therefore every following close/start write is to C, while S and the input scalar/array remain unchanged.

This establishes the exact caller precondition for the terminal branch without treating the flat public tool schema as the action discriminator: `TaskToolParameters` may present the convenient field, but `parseTaskRequest` remains the exact action-specific guard.

### 2. Close/order branch — `executeTaskRequest`

For `done` or `expire`, the CFG is: closure-order scan → exhaustion return or `executeDoneOrExpire` → helper-error return or target lookup/order assignment → (`done` only) handoff → `finish` → result-text projection.

- At `closedOrder = 0`, the NSP is that zero is the maximum of the empty scanned prefix and the lower bound for absent legacy orders.
- After scanning k task records, the invariant is `closedOrder = max(0, closedOrder of every scanned record)`, with no candidate write. For a three-record prefix `[2, undefined, 5]`, the values are `0 → 2 → 2 → 5`; for zero records it remains `0`, for one record it is that record/zero maximum, and for two records it is the maximum of those two/zero. The next `Math.max` maintains the invariant. The finite task-array length is the progress measure, so the loop terminates with the maximum over all C.
- The exhaustion branch returns before `executeDoneOrExpire`, hence before a handoff. A helper error also returns before target lookup/order assignment/handoff. `executeDoneOrExpire` validates missing targets before writing and never removes a record, so after normal success the target lookup is established by the helper’s contract; assigning `closedOrder + 1` gives the next closure rank exactly once for this invocation.
- The ternary invokes `executeStartNext` only when `request.action === "done"`; `expire` receives `[]` and has no handoff field in the exact request union. This preserves standalone expire behavior.

### 3. Normalization and ordered start loop — `executeStartNext`

`executeStartNext` has exactly three normalization branches and no task selection branch:

- omitted `startNext` produces `ids=[]`;
- a scalar produces a fresh singleton `[id]`;
- an array uses its supplied order directly without writing it, sorting it, deduplicating it, or rejecting it.

Let C0 be the candidate immediately after successful close/order assignment and O0 be `[]`. Before loop iteration i, the invariant is:

1. Ci is exactly C0 after applying the existing `executeStart` to `ids[0..i)` in order;
2. Oi has exactly i outcomes, one projection for each prior ID in that same order;
3. S and the source `startNext` value are unchanged.

The required finite-loop traces are:

- **0 IDs:** the loop body does not execute; O0 remains empty and C0 remains the completed candidate. Omitted input and `[]` therefore retain the existing `#id done` text/no-outcome behavior.
- **1 ID:** `executeStart(ids[0], C0, nextId)` either rejects before its target write and appends one `start_skipped` with its exact error, or sets that target to `in_progress` and appends one `started`. This is the scalar handoff case.
- **2 IDs:** the second call receives C1, not C0. It therefore observes the first target’s new status/dependency-visible state. With duplicate IDs, a successful first start makes the second call return the existing non-pending error and append `start_skipped`; there is no special duplicate policy.
- **3 IDs:** after the third call, O3 is the three input-order projections. A blocked or missing second target appends `start_skipped` but cannot stop the third call because the loop has neither `break` nor early return. The direct regression covers `[2, 3, 99]` as started, blocked, missing in that order.

Initialization is O0/C0 above. Maintenance follows because existing `executeStart` either writes only its successful candidate target or returns its error before a write, and the code unconditionally appends one outcome after each call. Termination follows from the monotonically advancing `for ... of` over finite `ids`. Thus the loop entails the design’s “once for each named ID, in order, against prior-attempt state” requirement. It also proves non-automatic behavior: the only iterable is normalized `startNext`; no loop/filter scans ready tasks.

### 4. Outcomes, `partial`, and text — `finish` plus terminal projection

Each loop iteration projects the existing helper result to exactly one existing outcome type:

- no `details.error` → `{ kind: "started", id, message: "#id started" }`;
- existing `details.error` → `{ kind: "start_skipped", id, message: "#id not started: <same error>" }`.

For this handoff, `finish` receives `error=undefined` and `changed=true`. Its `outcomes.some(({ kind }) => kind.includes("skipped"))` is true exactly when at least one handoff projection is `start_skipped`, because the handoff can emit only `started` or `start_skipped`. Therefore a business start failure yields `partial=true` without `details.error`, as specified; close/shape errors take the earlier error branches and have no outcomes. `finish` derives detached full-state rows/details and does not persist.

The terminal branch then replaces only `result.content` with: existing done text for no outcomes; otherwise the done line followed by every outcome message; and `Partially applied:` iff the established `partial` is true. It neither changes C nor drops an outcome. This makes a completed close with skipped starts visibly partial rather than a false whole-call error. Existing standalone `start` remains the earlier branch that directly calls `executeStart`; no handoff normalizer is reachable from it, and a non-`done` `startNext` has already failed parsing.

## Publication, exception, and ordering boundaries

`TaskSession.execute` invokes the pure transform inside a catch. If a normally unreachable transform exception occurs after candidate-local writes (for example, an engine/time failure inside an existing lifecycle helper), it returns `taskOperationFailure` built from the retained controller state and does not call `publish`; C is not installed. This is the established candidate-isolation boundary, not a new rollback rule.

For the normal changed handoff operation, `publish` raises the allocation floor before I/O, clones the complete post-handoff candidate, invokes `persist` exactly once, and installs only after the synchronous callback returns. The success NSP is one persisted/installable C containing the done target and every successful named start. If persistence throws, the catch returns the existing non-partial persistence error with old controller records and retained floor; native log/disk effects remain uncertain and are not claimed rolled back. `task.ts` calls this one controller operation and notifies only after a changed operation returns, so notification is not a second task-state persistence attempt.

Within one request, ordering is independently proven by the start loop regardless of host scheduling. `tool-definition.ts` declares `executionMode: "sequential"`, but `principles.md`/`integration-plan.md` correctly record that whether the actually loaded host forwards and honors this metadata is a deployment fact, not established by these source tests. That live-runtime boundary remains for the requested reload interaction test; it is not an unproven handoff CFG edge or a reason to add a scheduler workaround.

## Direct verification evidence

The following commands were run independently against the current tree after source review:

```sh
TSX_TSCONFIG_PATH=my-plugins/oh-my-pi-v2/tsconfig.task-system.json \
node --import tsx --test my-plugins/oh-my-pi-v2/test/task-system-handoff.test.ts
# 7/7 passing, 1 suite

TSX_TSCONFIG_PATH=my-plugins/oh-my-pi-v2/tsconfig.task-system.json \
node --import tsx --test \
  my-plugins/oh-my-pi-v2/test/task-system-*.test.ts \
  my-plugins/oh-my-pi-v2/test/task-session-state.test.ts \
  my-plugins/oh-my-pi-v2/test/task-command.test.ts \
  my-plugins/oh-my-pi-v2/test/task-display.test.ts
# 112/112 passing, 19 suites; no failure/cancel/skip/todo

node node_modules/typescript/bin/tsc \
  -p my-plugins/oh-my-pi-v2/tsconfig.task-system.json
# exit 0

node node_modules/@biomejs/biome/bin/biome check \
  --config-path my-plugins/oh-my-pi-v2/biome.task-system.json \
  my-plugins/oh-my-pi-v2/tools/task-system/*.ts \
  my-plugins/oh-my-pi-v2/test/task-system-*.ts \
  my-plugins/oh-my-pi-v2/tsconfig.task-system.json \
  my-plugins/oh-my-pi-v2/biome.task-system.json
# checked 34 files; no fixes/errors
```

The handoff suite directly witnesses close-before-unblock/start, ordered mixed results, empty/duplicate natural behavior, failed-close zero handoff, non-`done`/malformed shape rejection, caller-input immutability, omitted-field compatibility, one session persistence, and schema/call rendering. The generated suite adds 4,000 deterministic mixed transitions including scalar and duplicate handoffs with an independent DAG oracle. These executions corroborate the derivation; they are not a substitute for the stated Requires or the pending live-host scheduling check.

## Disposition

No handoff-specific design violation, missing proof edge, duplicated start validation, hidden auto-start, unreported business start failure, extra persistence call, or input/state aliasing defect was found. No code/test/config was changed by this audit. The only residual is the explicitly documented runtime question of whether the host loaded after reload honors sequential tool metadata; test that interaction directly rather than treating static metadata as deployment proof.
