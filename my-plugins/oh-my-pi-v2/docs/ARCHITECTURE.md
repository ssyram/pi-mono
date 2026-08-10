## State Persistence and Resume

- Workflow state is stored in `.pi/oh-my-pi-state.json` as `WorkState`.
- `WorkState` includes `activePlan`, `stage`, `round`, `gate1Rejections`, `startedAt`, and `lastUpdated`.
- `/omp-start --resume` reloads `WorkState`, then the active plan file from `.pi/oh-my-pi-plans/<activePlan>.md`, resumes by `stage`, and continues from the current round.
- Stage 1 plan files contain YAML; Stage 2 plan files contain Markdown updated each round.

## Orchestration Implementation

- Momus is spawned in separate fresh sessions for Gate 1, Collaborative Review, and Final Self-Review.
- Persistent Momus sessions were rejected because of role confusion, context pollution, and resource waste.
- `MAX_GATE1_REJECTIONS = 3`.
- `MAX_STAGE2_ROUNDS = 20`.

## UltraWork 4-Stage Execution

- `/omp-ultrawork` integrates design, implementation, and verification into a single 4-stage workflow.
- Stage 0 uses parallel explore agents; Stage 1 delegates to `hoare-design.md`; Stage 2 delegates to `workflow.md` §4; Stage 3 is the 9-step `hoare-audit.md` loop; Stage 4 produces the completion report.
- UltraWork state is stored as a session-log custom entry (`omp-ultrawork-state`). Resume walks upward through the current session branch to find the latest valid UltraWork entry; if none is present, UltraWork defaults to `false`.

## Task List v0.2.0

The normative design, contracts, correctness argument, and acceptance plan are in [`task-list-v0.2.0.md`](task-list-v0.2.0.md).

- Task state and widget visibility are session-log custom entries. Visibility affects only the compact widget, not task tracking or Boulder.
- Compact rows are width-aware and single-line. Blocked rows reserve space for at most three unresolved blocker IDs before task text.
- `/task show on|off`, `/task info`, and `/task help` expose visibility, complete inspection, and help with hierarchical prompted completion.
- Normal turns no longer receive a dynamic task-list system-prompt suffix. Explicit Boulder resumes contain actionable tasks plus the `<CONFIRM-TO-STOP/>` escape protocol; collapsed rendering shows `↻ Automatic Boulder resume`, while expanded rendering shows the exact model-visible content.
- A context filter retains only the currently live resume, while custom compaction removes all resume history and adds the current actionable task set separately.
- Boulder retry state is keyed by session identity. External information cancels a wait; print mode permits three attempts and other modes ten.
- Scheduling immediately appends the AI-invisible entry `↻ Automatic Boulder n/N resume scheduled, restarting in XXs`, while the status line refreshes the live countdown. Attempt/delay metadata is not sent to the model.

## Appendix: Terminology

| Term | Meaning |
|---|---|
| `Pre/Post/Invariants` | Hoare logic contracts |
| `Stage 1` | Intent confirmation phase with YAML form generation |
| `Stage 2` | Design document collaboration phase with a Markdown document |
| `UltraWork` | 4-stage execution framework: design intent detection → design → implementation → audit |
| `WorkState` | Persistent state object enabling resume after interruption |

## Appendix: File Locations

- `.pi/oh-my-pi-state.json` — workflow state persistence, including `activePlan`, `stage`, `round`, etc.
- `.pi/oh-my-pi-plans/<name>.md` — plan documents
- Task state — latest valid `omp-task-state` custom entry in the current session branch.
- Task widget visibility — latest valid `omp-task-widget-state` custom entry in the current session branch; defaults to visible when absent.
- UltraWork session state — latest valid `omp-ultrawork-state` custom entry in the current session branch; upward lookup on resume; defaults to `false` when absent.

## Appendix: Design Evolution History

- V1 was monolithic and implemented execution/web/MCP in-house.
- V2 is a thin orchestration runtime delegating execution to `pi-subagents`, web access to `pi-web-access`, and MCP to `pi-mcp-adapter`.
- Prometheus restructuring moved verification to the Hoare pipeline and added Momus as a lightweight reviewer.
- Two-stage workflow history: single-stage → two-stage without Momus → current two-stage with Momus.

## Appendix: Future Considerations

- Audit agent nesting depth
- Workflow/Hoare fusion
- Design intent detection accuracy

## Document Maintenance

- Update this document for major architectural changes, design reversals, and methodology updates.
- Review cadence is quarterly.

## Version History

- `2026-05-11`: OMP Task List v0.2.0 — compact width-aware widget, `/task` controls and completion, bounded session-owned Boulder retries, external-information cancellation, and filtered custom resume context. See [`task-list-v0.2.0.md`](task-list-v0.2.0.md).
- `2026-04-26`: Initial version (post-Prometheus/Momus restructuring)
