# Level 1 / 1.5 / 2 Derivation Map

This file records how each Level 2 principle is argued from Level 1 commitments and Level 1.5 evidence.

## Derivation Table

| Level 2 principle | Level 1 support | Level 1.5 support | Level 3 consistency target |
|---|---|---|---|
| Host-native authority | L1-4, L1-1 | E2, E10 | In-process pi plugin; state owned by plugin, not an external daemon. |
| Runtime externalization | L1-1, L1-3 | E2 | Stack/state/tape files, load/persist/resume, stop-hook re-injection. |
| Declared semantic closure | L1-2, L1-3 | E3, E5 | Parser validation, canonical condition contract, no hidden fallback semantics; post-interpolation executable trust boundaries remain lower-layer limitations. |
| Extension projection | L1-3 | E6 | Builtins lower to canonical condition objects before engine runtime. |
| Explicit evidence capability | L1-5 | E3, E6 | Tape capability is granted through declared condition/builtin semantics; this is not key-level provenance. |
| Control/evidence separation | L1-5 | E4 | `state.json` may roll back while `tape.json` remains cumulative. |
| Routing/model separation | L1-3 | E3, E8 | Epsilon routing proceeds without LLM discretion. |
| Authorization surface separation | L1-4 | E7, E8 | User-only recovery commands, interactive gates, tool/command partition; model-visible observation may exist but must not gain mutation authority. |
| Observation non-interference | L1-4 | E7 | Inspection/reporting paths may notify, return text, or write artifacts, but do not advance or alter control state. |
| Serialized authority with scoped failure visibility | L1-3, L1-5 | E2, E4 | `withSessionLock`, corruption-visible persistence, fail-closed handling; best-effort hook/cleanup limitations remain documented. |
| Ordinary-state liveness with declared pause exceptions | L1-3, L1-4 | E8 | `agent_end` re-injection for ordinary states, with interactive and operational pause/suppression exceptions. |
| Structural validity humility | L1-6 | E5 | Parser reachability is structural only; runtime completion remains separate. |
| Optional method projection | L1-2 | E6, E10 | Self-check/review/instance methods are flow-level projections, not substrate law. |
| Auditability pressure | L1-4 | E9 | Current history is a known weakness/design pressure, not append-only auditability. |

## Notes on Argument Quality

- If the Level 1.5 support for a principle is only an example or one instance-specific workflow, the principle should be downgraded or localized.
- If the Level 3 consistency target requires a code change, that does not automatically invalidate the principle; it only means the principle is currently stronger than the implementation baseline.
- If the principle cannot point to an existing lower-layer citation, it is probably too abstract or too weak.

## Potential Downgrades

The following candidates need special scrutiny before they stay in Level 2:

- `Auditability pressure` — currently remains a design pressure and limitation marker, not a claim that append-only history already exists.
- `Optional method projection` — must not become a disguised rule that all flows should use a particular authoring style.
- `Host-native authority` — must stay framed as the chosen substrate architecture, not as a universal preference.
- `Declared semantic closure` — must not imply post-interpolation command revalidation that current Level 3 behavior does not provide.
- `Explicit evidence capability` — must stay at capability level; it must not imply key-level evidence provenance or that tape passing is always manual in YAML.
- `Serialized authority with scoped failure visibility` — must not erase documented best-effort hook and cleanup limitations.
