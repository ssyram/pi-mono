# Level 3 to Level 2 Extraction

This file records the upward extraction from existing Steering Flow Level 3 material to Level 2 candidate design principles. It is a trace document, not the final constitution.

## Source Set

Level 3 sources reviewed in this pass:

- `my-plugins/steering-flow/README.md`
- `my-plugins/steering-flow/docs/ARCHITECTURE.md`
- `my-plugins/steering-flow/docs/execution-behavior.md`
- `my-plugins/steering-flow/docs/configuration-tutorial.md`
- `my-plugins/steering-flow/docs/builtin-procedures.md`
- `my-plugins/steering-flow/docs/comparison-with-mcp-server-fsm.md`
- `my-plugins/steering-flow/docs/correctness-audit.md`
- `my-plugins/steering-flow/docs/hoare-audit-2026-04-21.md`
- `my-plugins/steering-flow/docs/ultra-work-instance.md`
- `my-plugins/steering-flow/skills/steering-flow-author/SKILL.md`

## Extraction Table

| Level 3 fact | Upward Level 2 candidate | Why it is not merely Level 3 |
|---|---|---|
| The README and architecture define Steering Flow as an in-process pi plugin that enforces user-authored FSM workflows, not a daemon, MCP server, or general task runner. | Host-native workflow authority | The design answer depends on pi-native authority surfaces rather than copying MCP server mechanics. |
| Active flows are parsed into FSM objects, pushed onto a session stack, persisted, resumed, and re-injected at `agent_end` for ordinary states. | Externalize procedural intent into runtime state | The lower design relies on workflow state existing outside model memory and natural-language summaries. |
| Flow configs declare states, actions, arguments, conditions, next states, epsilon routing, and `$START`/`$END`. Parser validation rejects ambiguous or structurally dead flows. | Declared flow semantics are the source of ordinary execution authority | Runtime behavior is constrained by declared language semantics rather than ad hoc model interpretation. |
| Conditions are canonical `{ cmd, args? }` objects, executed by direct `spawn` without shell, with stdout first-line boolean semantics. | External checks must have closed, deterministic invocation semantics | This is a general design commitment: branch authority must come from a bounded external contract, not shell or prompt interpretation. |
| Builtins are parser-expanded into canonical condition objects before engine runtime; the engine never sees builtin names. | Extensions must project into declared core semantics | Optional helpers must not enlarge hidden runtime authority. |
| Tape access for conditions and builtins is explicit through `${$TAPE_FILE}` or declared `needs_tape`, not ambient. | Evidence access must be explicit | Lower layers depend on knowing which external checks can observe or mutate flow evidence. |
| `current_state_id` can roll back after failed epsilon chains, but tape is cumulative and never rolled back. | Separate rollbackable control state from cumulative evidence | This split appears across storage, engine, audits, and examples; it is a project-wide design commitment. |
| Epsilon states route automatically in declared order without LLM involvement; ordinary work states return legal actions to the model. | Separate model work selection from data-driven routing | The system deliberately removes routing discretion from the model when the flow author declares data-dependent routing. |
| Interactive states reject model-visible action channels and can only be advanced by user-only commands or later user prompts. | Authorization surfaces are semantic boundaries | This is not UI detail; it defines who may change control position. |
| `/steering-flow pop`, `set-state`, `reset-state`, `set-action`, `visualize`, and command-only `info` are not LLM tools. | Recovery and observation authority must not be granted to ordinary model action | Lower tools and commands are partitioned by authority, not just convenience. |
| `info` and `visualize` are notify-only or contained observation surfaces; visualization is command-only and non-overwriting. | Observation must not mutate control state | The project treats inspection as separate from execution authority. |
| Load/action/stop flows run under `withSessionLock`, writes use atomic temp+rename, and corrupt state is surfaced. | Runtime authority must be serialized and failure-visible | The lower implementation depends on single-session ordering and visible failure rather than silent recovery. |
| Ordinary active states are re-injected through `agent_end`; interactive states pause; stagnation and abort guards exist. | Non-terminal ordinary flows remain live, with declared pause exceptions | The design target is to resist premature model stopping while preserving user gates and operational escape hatches. |
| Parser reachability proves only structural paths to `$END`; docs explicitly say it does not prove runtime completion. | Valid structure is not workflow success | This prevents overclaiming parse validity as task-quality or runtime-completion guarantee. |
| `comparison-with-mcp-server-fsm.md` records that Steering Flow lacks append-only transition history and self-check/soft-review protocol as core features. | Auditability is required but current history is a known weaker Level 3 design | This distinguishes actual guarantees from desirable or externally stronger designs. |
| `soft-review/*` builtins ship as fail-closed stubs and the authoring skill presents review gates as patterns, not universal validity requirements. | Flow-quality methods are optional projections, not infrastructure law | This protects user flow authorship and prevents infrastructure from imposing a workflow methodology. |
| `ultra-work-instance.md` uses Steering Flow for OMPv2 flow control but says Steering Flow itself does not understand OMPv2. | Instance semantics must not be confused with core runtime semantics | Concrete workflows can impose stronger laws, but those laws do not automatically enter the substrate constitution. |

## Candidate Level 2 Principles

The extraction above yields the following candidate Level 2 principles for formal argument:

1. Host-native authority: use pi-native tools, commands, hooks, and storage as the enforcement substrate.
2. Runtime externalization: procedural intent must become persisted runtime state, not prompt-only discipline.
3. Declared semantic closure: ordinary execution is governed by the accepted flow language and canonical condition contract.
4. Extension projection: builtins and helpers must lower into declared core semantics instead of adding hidden engine law.
5. Explicit evidence capability: tape access and evidence mutation capability must be granted through declared condition semantics and remain attributable to that contract.
6. Control/evidence separation: rollbackable control state and cumulative tape evidence have different semantics.
7. Routing/model separation: data-dependent routing belongs to epsilon/condition execution, not model discretion.
8. Authorization surface separation: model action, user control, recovery, and observation surfaces are semantically distinct.
9. Observation non-interference: inspection and reporting must not mutate control state.
10. Serialized authority with scoped failure visibility: core runtime operations must be serialized, and execution failures must be surfaced within documented best-effort limits.
11. Ordinary-state liveness with declared pause exceptions: non-terminal ordinary states stay active unless a documented pause/suppression condition applies.
12. Structural validity humility: parser validity and reachability are not task success or workflow quality guarantees.
13. Optional method projection: review, self-check, OMPv2, and authoring patterns are optional flow-level methods unless declared by a specific flow.
14. Auditability pressure: users should be able to reconstruct enough state movement to check substrate fidelity; current non-append-only history is a known weakness, not an existing guarantee.

## Rejected as Level 2

The following are Level 3 details and should not be promoted into constitution-level principles:

- Exact timeout and output cap values.
- Exact tape file paths and state file names.
- Exact YAML/Markdown parsing rules.
- Exact ID regexes.
- Exact stdout wording beyond the closed boolean-result contract.
- Exact command names and slash-command syntax.
- Concrete example state names and tape keys.
- Specific authoring checklist items such as always adding self-check before high-stakes transitions.
- OMPv2-specific stage structure from `ultra-work-instance.md`.

## Next Step

Formalize Level 0, Level 1, Level 1.5, and argued Level 2 principles. Each Level 2 principle must cite the Level 1 commitment and Level 1.5 observations that support it, and must explain its Level 3 consistency.
