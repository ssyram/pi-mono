# finegrained-agent — Controlled Multi-Phase Consistency Analysis Pipeline

## Overview

A pi extension that replaces the prompt-template-based `/finegrained-check` with a **rigid, programmatically-controlled pipeline**. Each phase runs in an isolated sub-agent session with a dedicated system prompt, constrained tool set, and structured output schema. Phases fan out into parallel sub-tasks for scalability.

## Problem

The current `/finegrained-check` prompt template relies on model self-discipline:
- Phases can be skipped, merged, or partially executed
- Proposition count does not scale with scope size
- Proposition IDs may drift or collide across phases
- No structured intermediate state — can't audit, resume, or verify
- Context exhaustion causes silent data loss in later phases

## Architecture

### Approach: Extension + SDK Hybrid

- **Extension** registers `/finegrained-agent` as a slash command (TUI entry point)
- **Pipeline orchestrator** drives each phase via `createAgentSession` with `SessionManager.inMemory()`
- **ConcurrencyManager** (from oh-my-pi) handles parallel sub-tasks with per-model limits
- **File-based workdir** (`.pi/finegrained-runs/<run-id>/`) stores all intermediate artifacts for audit and resume

### DAG

```
/finegrained-agent <target>
         │
         ▼
   Phase 0: Scope Determination (1 session, main model)
         │
    ┌────┴────┐
    ▼         ▼
Phase 1:   Phase 3a:
Extract    Design Dims
(K shards) (1 session)
    │         │
    ├────┐    │
    ▼    ▼    ▼
 Ph2a  Ph2b  Ph3b:
 cross intra matrix
 pairs group cells
(N²/2) (N)  (M²/2)
    │    │    │
    └─┬──┘    │
      ▼       │
  Merge       │
  Findings    │
      │       │
      └───┬───┘
          ▼
    Phase 5: Score & Rank (1 session, main model)
          │
          ▼
    Phase 6: Report Generation (1 session, main model)
```

## Phases

### Phase 0 — Scope Determination
- **Model**: main (user's configured model)
- **Tools**: read, bash, grep, glob
- **Input**: target path/topic
- **Output**: `ScopeResult` — file list grouped by type, total lines, module structure digest
- **Session count**: 1

### Phase 1 — Proposition Extraction (Sharded)
- **Model**: gpt-5.4-nano
- **Tools**: read (target files only)
- **Input**: shard file subset + scope digest + target proposition count
- **Output**: `Proposition[]` per shard, merged and renumbered after all shards complete
- **Session count**: K shards (1–8, based on file count)
- **Scaling**: `targetPropositions = clamp(10, 300, ceil(totalLines / 500 * 7))`

### Phase 2a — Cross-Group Contradiction Detection
- **Model**: gpt-5.4-nano
- **Tools**: read (source files for verification)
- **Input**: two proposition groups + scope digest
- **Output**: `Finding[]` per pair
- **Session count**: N*(N-1)/2 where N = group count
- **Grouping**: propositions grouped by source file/module, ~8 propositions per group

### Phase 2b — Intra-Group Contradiction Detection
- **Model**: gpt-5.4-nano
- **Tools**: read (source files for verification)
- **Input**: single proposition group + scope digest
- **Output**: `Finding[]` per group
- **Session count**: N

### Phase 3a — Design Dimension Extraction
- **Model**: main model
- **Tools**: read
- **Input**: scope + condensed proposition list (subject + source only)
- **Output**: `DesignPoint[]` (8–20 dimensions with tags)
- **Session count**: 1
- **Runs in parallel with Phase 1**

### Phase 3b — Design Matrix Cell Verification
- **Model**: gpt-5.4-nano
- **Tools**: read
- **Input**: two design points + relevant proposition subset (filtered by tags)
- **Output**: `MatrixCell` (covered/gap + explanation)
- **Session count**: M*(M-1)/2

### Phase 5 — Merge & Re-Score
- **Model**: main model
- **Tools**: none (pure reasoning)
- **Input**: all findings from Phase 2a/2b + all matrix gaps from Phase 3b
- **Output**: `ScoredFinding[]` — deduplicated, severity reassigned
- **Session count**: 1

### Phase 6 — Report Generation
- **Model**: main model
- **Tools**: write
- **Input**: all structured data (scope, propositions, findings, matrix, scores)
- **Output**: final `.md` report file
- **Session count**: 1

## Workdir Structure

```
.pi/finegrained-runs/<run-id>/
├── state.json                # PipelineState (orchestrator maintains)
├── scope.json                # Phase 0 output
├── shards/
│   ├── extract-01/
│   │   ├── input.json        # Shard file subset
│   │   └── output.json       # Proposition[]
│   └── extract-02/...
├── propositions.json         # Phase 1 merged output
├── design-points.json        # Phase 3a output
├── pairs/
│   ├── cross-G01-G02/
│   │   ├── input.json        # Two groups
│   │   └── output.json       # Finding[]
│   └── intra-G01/...
├── matrix/
│   ├── cell-D01-D02/
│   │   ├── input.json        # Two dimensions + proposition subset
│   │   └── output.json       # MatrixCell
│   └── ...
├── findings-scored.json      # Phase 5 output
└── report.md                 # Phase 6 output
```

## Context Management

Each sub-session receives only what it needs:

| Sub-session | Context contains | Context excludes |
|---|---|---|
| Phase 0 | target path | — |
| Phase 1 shard | shard files, scope digest, target count | other shards |
| Phase 2a pair | two groups, scope digest | other pairs, intra results |
| Phase 2b group | one group, scope digest | other groups, cross results |
| Phase 3a dims | all propositions (condensed), scope | findings |
| Phase 3b cell | 2 dimensions + relevant propositions | other cells |
| Phase 5 merge | all findings + all matrix gaps | raw propositions |
| Phase 6 report | all structured JSON | — |

## Auto-Scaling

| Parameter | Formula | Notes |
|---|---|---|
| targetPropositions | `clamp(10, 300, ceil(totalLines / 500 * 7))` | ~7 per 500 lines |
| minPropositions | `clamp(10, 300, ceil(totalLines / 500 * 5))` | threshold for retry |
| extractShardCount | `clamp(1, 8, ceil(fileCount / 10))` | ~10 files per shard |
| groupSize | `clamp(5, 12, ceil(sqrt(targetPropositions)))` | propositions per group |
| groupCount | `ceil(targetPropositions / groupSize)` | contradiction groups |
| crossPairCount | `groupCount * (groupCount - 1) / 2` | Phase 2a tasks |
| designPointCount | `clamp(8, 20, ceil(sqrt(targetPropositions * 2)))` | design dimensions |
| matrixCellCount | `designPointCount * (designPointCount - 1) / 2` | Phase 3b tasks |
| nanoConcurrency | 10 (configurable) | gpt-5.4-nano parallel limit |

### Scale Examples

| Scope | Props | Groups | Cross | Intra | Dims | Matrix | Total nano tasks |
|---|---|---|---|---|---|---|---|
| 20 files, 2k LOC | ~28 | 4 | 6 | 4 | 8 | 28 | ~42 |
| 60 files, 10k LOC | ~140 | 12 | 66 | 12 | 17 | 136 | ~226 |
| 200 files, 40k LOC | ~300 | 25 | 300 | 25 | 20 | 190 | ~540 |

## Structured Output Enforcement

Each phase registers a dedicated "submit" tool. The sub-session's system prompt ends with:

> "完成分析后，必须调用 `submit_xxx` 工具提交结果。不调用此工具的回复将被忽略。"

The pipeline validates the tool call's JSON against the schema. Invalid output triggers one retry with error feedback.

## Failure Handling

| Scenario | Action |
|---|---|
| Sub-task timeout/error | Retry once; still fails → mark `inconclusive` |
| Invalid JSON output | Retry with stricter prompt + error details; still fails → degrade |
| crossPairCount > 200 | Auto-increase groupSize, regroup, reduce pairs |
| User abort (Esc) | `cancelAll(pipelineJobId)` cascades; completed results preserved |
| Resume (`--resume <run-id>`) | Skip phases with existing valid output files |

## File Layout

```
my-plugins/finegrained-agent/
├── DESIGN.md
├── package.json
├── index.ts                     # Extension entry: registerCommand
├── src/
│   ├── types.ts                 # All type definitions
│   ├── auto-scale.ts            # Scaling calculations
│   ├── pipeline.ts              # Main DAG orchestrator
│   ├── phase-runner.ts          # Generic sub-session runner
│   ├── phases/
│   │   ├── phase-0-scope.ts
│   │   ├── phase-1-extract.ts
│   │   ├── phase-2-check.ts
│   │   ├── phase-3-matrix.ts
│   │   ├── phase-5-score.ts
│   │   └── phase-6-report.ts
│   └── prompts/
│       ├── phase-0.md
│       ├── phase-1.md
│       ├── phase-2a-cross.md
│       ├── phase-2b-intra.md
│       ├── phase-3a-dims.md
│       ├── phase-3b-cell.md
│       ├── phase-5.md
│       └── phase-6.md
```
