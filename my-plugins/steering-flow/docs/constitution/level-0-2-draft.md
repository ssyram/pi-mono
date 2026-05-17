# Steering Flow Retrofit Constitution Draft

This document is the first draft of Level 0 through Level 2 material for `my-plugins/steering-flow`.

It is a retrofit constitution: the project already has running code, Level 3 design documents, examples, and audits. The task is not to invent a workflow doctrine from scratch, but to extract the project’s existing higher-level commitments, separate them from Level 3 implementation detail, and make them available for lower layers to cite.

## 0. Scope

This constitution applies to the Steering Flow substrate inside `my-plugins/steering-flow`.

It does not define a universal workflow ideology for every user flow. It defines the substrate commitments that the existing implementation already depends on and that lower layers must be able to cite.

## 1. Layer Definitions

- Level 0: the root problem that necessarily exists before any design answer.
- Level 1: the essential commitments that cannot be recovered from raw requirements or implementation detail alone.
- Level 1.5: the empirical observations, audit findings, and experience-derived axioms that support Level 1 and Level 2.
- Level 2: the design principles that must be argued from Level 1 and Level 1.5, and that can be used to evaluate Level 3.
- Level 3: the existing architecture, runtime behavior, configuration syntax, examples, and code.

## 2. Level 0: Root Problem

Steering Flow exists because user-authored procedural intent must remain operative inside an LLM-driven session even though the model is not a reliable executor of branching, retry, data-dependent, or resumed workflow.

The root problem is not “how do we teach the model to behave better.” The root problem is how to make declared procedural intent survive as a runtime object that can be resumed, checked, and advanced without depending on the model’s memory or goodwill.

This root problem exists before any particular flow, example, or authoring method.

## 3. Level 1: Essential Commitments

### L1-1. Procedural intent must outlive the model’s narrative

The workflow cannot live only in prompt text, model memory, or a natural-language summary. It must exist as a runtime object that the substrate can load, persist, inspect, advance, and resume.

### L1-2. The flow author owns the flow

The substrate may define the accepted language and execution semantics, but it must not silently replace the user’s declared flow with an unspoken method doctrine of its own.

### L1-3. Once accepted, declared flow semantics must be executed

If the runtime accepts a flow, it must execute the semantics declared by that flow rather than falling back to model interpretation, convenience recovery, or hidden policy.

### L1-4. Authority boundaries are semantic, not cosmetic

Model action, user control, recovery, and observation are different authority surfaces. They are not merely different UI affordances.

### L1-5. Evidence and control are not the same thing

A flow needs a controllable state position and a cumulative evidence store. A failure in one should not silently rewrite the other.

### L1-6. Valid structure is not task success

A flow that is structurally valid is not therefore successful at runtime. Parse-time legality, reachability, and syntax checks are necessary but not sufficient for completion.

## 4. Level 1.5: Empirical Observations and Axioms

### E1. The model drifts, stops early, and cannot be trusted to preserve procedural state

This is the motivating observation behind the whole substrate. It is why Steering Flow exists at all.

### E2. A pi plugin can own runtime state in-process

The existing implementation already uses `stack.json`, `fsm.json`, `state.json`, and `tape.json` under `.pi/steering-flow/<SESSION-ID>/` and serializes core operations with `withSessionLock`.

### E3. External condition checks are reliable only when their contract is closed

The engine uses direct `spawn`, no shell, first-line boolean stdout, capped output, and timeout handling. Those details are implementation choices, but they support the broader observation that condition execution must be bounded and declarative.

### E4. Tape writes and state advancement have different failure behavior

Current code and audits show the project intentionally preserves tape writes across some failed transitions while rolling back control state. This is a deliberate design property, not an accident.

### E5. Parse validity and structural reachability do not prove runtime completion

The parser can prove that `$END` is reachable and that no reachable dead-end exists, but conditions can still fail at runtime. Therefore parser success is not workflow success.

### E6. Builtins are lowerings, not hidden runtime authority

Builtin conditions expand to canonical condition objects before runtime. They do not add a second secret condition language.

### E7. Observation surfaces must not mutate flow state

`info`, `context-info`, model-visible info tools, and `visualize` are inspection paths. They may report to the UI, return model-facing text, or write contained artifacts, but they must not advance, recover, or otherwise mutate the FSM control position.

### E8. Interactive gates are intentional control boundaries

Interactive states are designed pauses that ordinary model action cannot bypass. They are a real authorization boundary, not an incidental UI pause.

### E9. Current history is weaker than append-only audit trails

The comparison with `mcp-server-fsm` shows that Steering Flow’s history model is weaker than an append-only audit log. That is a known limitation, not an existing guarantee.

### E10. Instance-level flows are not substrate law

The `ultra-work-instance` document shows that a particular flow can impose stronger instance semantics without turning those semantics into core substrate law.

## 5. Level 2: Design Principles

Each principle below is a candidate constitutional principle, not Level 3 detail. Each must be able to explain or constrain lower layers.

### P1. Host-native authority

Steering Flow must use the host plugin substrate, not a separate daemon or hidden server, as its enforcement surface.

Why this belongs at Level 2:

- It explains why the project is an in-process pi plugin.
- It distinguishes Steering Flow from `mcp-server-fsm` while preserving the same core problem.
- It constrains future design choices about authority placement.

Depends on:

- L1-1
- L1-4
- E2

### P2. Runtime externalization

Procedural intent must be materialized as runtime state that can be loaded, persisted, inspected, and resumed.

Why this belongs at Level 2:

- It explains the stack/state/tape split.
- It excludes prompt-only or memory-only workflow control.
- It supports both ordinary continuation and recovery.

Depends on:

- L1-1
- L1-3
- E2

### P3. Declared semantic closure

Once a flow is accepted, ordinary execution must be governed by the flow language and the canonical condition contract, not by hidden runtime interpretation.

This principle is about the declared language boundary, not a claim that every runtime string is revalidated after substitution. Current Level 3 behavior interpolates placeholders before command resolution and spawn, and post-interpolation executable trust boundaries remain a documented lower-layer limitation.

Why this belongs at Level 2:

- It explains why parser validation matters.
- It explains why conditions are canonical `{ cmd, args? }` contracts.
- It excludes ad hoc fallback semantics.

Depends on:

- L1-2
- L1-3
- E3
- E5

### P4. Extension projection

Builtins and helpers must lower into declared core semantics rather than create hidden runtime authority.

Why this belongs at Level 2:

- It keeps helper logic from becoming a second language.
- It preserves authoritativeness of the canonical condition model.
- It allows convenience without changing the substrate’s constitutional boundary.

Depends on:

- L1-3
- E6

### P5. Explicit evidence capability

Any condition or helper that can inspect or mutate flow evidence must receive that capability through declared condition semantics rather than ambient runtime access.

This is a capability-level principle, not a key-level provenance guarantee. A script that receives a tape path can read or write arbitrary tape keys; the constitutional requirement is that this capability is granted through the declared condition/builtin contract and remains attributable to that contract.

Why this belongs at Level 2:

- It explains explicit tape path and builtin tape-capability behavior.
- It prevents invisible evidence coupling between runtime and helpers.
- It lets lower layers reason about which conditions have evidence access capability, without pretending the substrate tracks every key-level read/write.

Depends on:

- L1-5
- E3
- E6

### P6. Control/evidence separation

Rollbackable control state and cumulative evidence tape are different kinds of state and must not be collapsed into one.

Why this belongs at Level 2:

- It explains why state can roll back while tape can persist.
- It clarifies failure semantics.
- It prevents silent loss of evidence during control recovery.

Depends on:

- L1-5
- E4

### P7. Routing/model separation

Data-dependent routing belongs to the declared flow machinery, not to model discretion.

Why this belongs at Level 2:

- It explains epsilon routing.
- It keeps the model from deciding branch outcomes that the flow already declared.
- It preserves predictable execution.

Depends on:

- L1-3
- E3
- E8

### P8. Authorization surface separation

Model action, user control, recovery, and observation must remain distinct surfaces with distinct authority.

This principle does not mean observation is absent from model-visible channels. It means observation/reporting channels do not acquire mutation or recovery authority merely because they can report state.

Why this belongs at Level 2:

- It explains why interactive states are user-only boundaries.
- It explains why `pop`, `set-state`, `reset-state`, and `visualize` are not LLM tools.
- It prevents authority leakage by convenience.

Depends on:

- L1-4
- E7
- E8

### P9. Observation non-interference

Inspection must not mutate control state.

Observation may report through UI notifications, return model-visible status, or create contained visualization artifacts. Those outputs are allowed only as inspection effects; they must not become hidden transition, recovery, or state mutation mechanisms.

Why this belongs at Level 2:

- It explains notify-only info paths, model-visible status reporting, and contained visualization as observation rather than control.
- It prevents observability from becoming a hidden transition mechanism.
- It supports auditability.

Depends on:

- L1-4
- E7

### P10. Serialized authority with scoped failure visibility

Core runtime mutations must be serialized per session, and failures in accepted flow execution must be surfaced when the substrate cannot faithfully complete the requested operation.

This principle is scoped. It does not claim that every best-effort maintenance path is user-visible or fatal. Stop-hook reminder errors, stale temp cleanup, and documented low-level limitations may be best-effort when surfacing them would be more destructive than the failure itself. Those exceptions must remain documented as limitations rather than being mistaken for successful execution guarantees.

Why this belongs at Level 2:

- It explains `withSessionLock`, corruption-visible persistence, and fail-closed parsing/condition behavior.
- It makes execution failure part of the contract instead of a hidden success path.
- It leaves room for documented best-effort hook and cleanup behavior without overstating current guarantees.

Depends on:

- L1-3
- L1-5
- E2
- E4

### P11. Ordinary-state liveness with declared pause exceptions

Non-terminal ordinary states should remain live across `agent_end` unless a documented pause or suppression condition applies. Interactive gates are the semantic pause case; operational guards such as user abort, compaction cooldown, repeated-reminder stagnation, corrupted state, empty stack, and `$END` are substrate safety exceptions.

Why this belongs at Level 2:

- It explains the stop-hook continuation behavior.
- It protects ordinary workflows from premature termination.
- It preserves intentional user gates while acknowledging current operational guardrails.

Depends on:

- L1-3
- L1-4
- E8

### P12. Structural validity humility

Parser validity and reachability checks are necessary structural gates, not proof of workflow quality or runtime completion.

Why this belongs at Level 2:

- It prevents overclaiming what the parser proves.
- It keeps success criteria honest.
- It separates syntax/liveness from actual runtime achievement.

Depends on:

- L1-6
- E5

### P13. Optional method projection

Self-check, review, OMPv2-specific staging, and authoring patterns are optional flow-level methods unless a specific flow explicitly declares them.

This principle is protective, not prescriptive: it prevents instance methods from becoming substrate law. It must not be used to require all flows to adopt any particular review, self-check, or OMPv2 pattern.

Why this belongs at Level 2:

- It prevents the substrate from imposing one workflow philosophy on all flows.
- It keeps higher-level methods available without making them infrastructure law.
- It protects user flow authorship.

Depends on:

- L1-2
- E6
- E10

### P14. Auditability pressure

The substrate should leave enough trace to reconstruct meaningful state movement, but current Steering Flow does not claim append-only transition history. The weaker current history model is a documented design pressure and auditability limitation.

Why this belongs at Level 2:

- It explains why the history weakness matters.
- It distinguishes current guarantees from desired future strengthening.
- It prevents the constitution from pretending that append-only auditability already exists.

Depends on:

- L1-4
- E9

## 6. Principle Selection Rules

A candidate principle stays in Level 2 only if all of the following hold:

- It is needed by lower layers.
- It can explain at least one existing design choice.
- It can exclude at least one plausible but wrong design choice.
- It does not prescribe a universal workflow doctrine to users.
- It does not collapse into a Level 3 detail such as a file path, regex, timeout, schema field, or example-specific stage.
- It can be cited by Level 3 documents or code behavior.

If a candidate fails these conditions, it should be moved down to Level 3, treated as a Level 1.5 observation, or deleted.

## 7. What Does Not Belong Here

The following belong below Level 2 unless a later revision proves otherwise:

- Exact timeout values and output caps.
- Exact storage file names and paths.
- Exact YAML parsing mechanics.
- Exact regexes for IDs.
- Exact command syntax and slash-command names.
- Exact example stage names and tape keys.
- Specific authoring checklists.
- Instance-only semantics from `ultra-work-instance.md`.
- Any rule that only makes sense for one example flow.

## 8. Working Conclusion

The project already contains enough Level 3 material to justify a real Level 0 through Level 2 constitution.

The main structural correction is that this is retrofit constitution work. The constitution must be derived from the current substrate and its audits, not from a blank-slate workflow ideology.

The next step is to validate each Level 2 principle against the Level 1.5 evidence and the current code baseline, then prune or downgrade anything that is actually a Level 3 detail.
