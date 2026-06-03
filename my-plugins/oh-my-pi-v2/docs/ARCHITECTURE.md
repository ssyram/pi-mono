## State Persistence and Resume

- Workflow state is stored in `.pi/oh-my-pi-state.json` as `WorkState`.
- `WorkState` includes `activePlan`, `stage`, `round`, `gate1Rejections`, `createdAt`, and `lastUpdatedAt`.
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
- `.pi/task-state.json` — task state
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

- `2026-04-26`: Initial version (post-Prometheus/Momus restructuring)
