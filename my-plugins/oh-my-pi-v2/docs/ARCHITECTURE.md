# OMPV2 Architecture

## Document Purpose

This document provides the authoritative architectural design for Oh-My-Pi V2 (OMPV2). It serves as the primary reference for understanding system structure, design decisions, and component interactions. Future development, refactoring, and audits must reference this document.

**Target Audience**: Developers working on OMPV2 6+ months from now who need to understand the system without access to the original designers.

**Scope**: This document covers architectural design and rationale. For API usage and command reference, see README.md. For methodology details, see the references/ directory.

## Philosophical Foundation: Correctness and Leverage

### The Three-Layer Definition of Correctness

OMPV2 defines project correctness through three hierarchical layers:

**Layer 1: Documentation Self-Consistency**
- Design documents are internally coherent (no contradictions)
- All critical design decisions are documented
- Documented behaviors are logically sound

**Layer 2: Code-Documentation Correspondence**
- Every significant code component has corresponding documentation (no orphaned code)
- Every documented behavior has corresponding implementation (no phantom features)
- Code behavior matches documented design (1:1 correspondence)

**Layer 3: Code Implementation Correctness**
- Code executes as intended (passes tests, diagnostics)
- Edge cases are handled
- Performance and security requirements are met

**Hierarchical Dependency**: Layer 2 depends on Layer 1 (cannot verify code-doc correspondence if docs are inconsistent). Layer 3 depends on Layer 2 (cannot verify implementation correctness if code doesn't match documented design).

---

### User Leverage Theory

OMPV2 is designed to maximize user leverage: minimal user effort maintains system correctness across all three layers.

**Leverage Mechanism**:

1. **User focuses on decisional items only**
   - System classifies all issues as Decisional (requires user judgment) or Non-Decisional (system can fix)
   - User invests effort only on Decisional items (design choices, tradeoffs, ambiguities)
   - System autonomously handles Non-Decisional items (bugs, typos, obvious optimizations)

2. **Documentation as the single source of truth**
   - User reviews/approves design documents (Stage 1 form + Stage 2 doc)
   - System ensures code matches approved documentation (Layer 2 verification)
   - User doesn't need to review code line-by-line

3. **Automated verification loops**
   - Audit agents verify Layer 1 (doc consistency), Layer 2 (code-doc correspondence), Layer 3 (code correctness)
   - System iterates until all layers pass
   - User only intervenes when decisional issues arise

**Leverage Ratio**: User effort is proportional to the number of decisional items, not the total codebase size. A 10,000-line project with 5 decisional items requires the same user effort as a 1,000-line project with 5 decisional items.

---

### Semi-Formal Correctness Proof

We provide a semi-formal proof that OMPV2's workflow guarantees three-layer correctness, given stated assumptions.

#### Definitions

- `Doc`: Design documentation (ARCHITECTURE.md, etc.)
- `Code`: Implementation codebase
- `User`: Human decision-maker
- `System`: OMPV2 agents (Sisyphus, Prometheus, Momus, audit agents)

**Correctness predicates**:
- `Consistent(Doc)`: Documentation is self-consistent (Layer 1)
- `Corresponds(Code, Doc)`: Code matches documentation 1:1 (Layer 2)
- `Correct(Code)`: Code implementation is correct (Layer 3)

**Goal**: Prove `Consistent(Doc) ∧ Corresponds(Code, Doc) ∧ Correct(Code)` after workflow completion.

---

#### Assumptions

**A1: User Decisional Judgment is Correct**
- When user approves a decisional item, the decision is correct
- Rationale: User is the domain expert; system cannot replace human judgment

**A2: Audit Agents Detect All Layer Violations**
- Audit agents detect all documentation inconsistencies (¬Consistent(Doc))
- Audit agents detect all code-doc mismatches (¬Corresponds(Code, Doc))
- Audit agents detect all code bugs (¬Correct(Code))
- Rationale: Audit agents use multiple specialized perspectives (functional, spec-impl, cross-boundary, etc.)

**A3: System Correctly Classifies Decisional vs Non-Decisional**
- System never misclassifies a decisional item as non-decisional
- System may conservatively classify non-decisional items as decisional (safe over-approximation)
- Rationale: Sisyphus prompt explicitly defines classification criteria; conservative bias prevents silent errors

**A4: Iteration Converges**
- Audit loops terminate (no infinite rejection cycles)
- Rationale: Gate 1 has 3-rejection limit; Stage 2 has 20-round limit; limits force escalation to user

**A5: Documentation-First Principle is Enforced**
- All code changes follow: Check Doc → Audit Doc → Update Doc → Implement Code → Verify Correspondence
- Rationale: Sisyphus prompt mandates this workflow; violations are flagged by audit agents

---

#### Proof Sketch

**Theorem**: Given assumptions A1-A5, OMPV2 workflow guarantees `Consistent(Doc) ∧ Corresponds(Code, Doc) ∧ Correct(Code)`.

**Proof**:

**Part 1: Consistent(Doc)**

1. Stage 1 produces intent confirmation form (proto-documentation)
2. Momus Gate 1 audits form for contradictions, missing decisions (A2)
3. If ¬Consistent(form), Momus rejects → Prometheus revises → repeat (A4 ensures termination)
4. Gate 1 approval implies Consistent(form) (by A2: audit agents detect all inconsistencies)
5. Stage 2 expands form into full design document
6. Momus Role 2 audits document for hidden decision points, contradictions (A2)
7. Prometheus updates document → Momus re-audits → iterate until Momus Role 3 declares complete
8. Momus Role 3 final review confirms Consistent(Doc) (by A2)
9. User approves decisional items in Doc (A1: user judgment is correct)
10. Therefore, Consistent(Doc) holds after Stage 2 completion. ∎

**Part 2: Corresponds(Code, Doc)**

1. Documentation-First Principle (A5) enforces: Doc is finalized before Code implementation
2. Sisyphus implements Code following approved Doc
3. After implementation, Sisyphus calls audit agents to verify Corresponds(Code, Doc) (A5: mandatory verification)
4. Audit agents flag [DESIGN_DOC_OUTDATED] if Code contradicts Doc (A2: agents detect all mismatches)
5. If ¬Corresponds(Code, Doc), Sisyphus updates Doc or fixes Code → re-audit → iterate (A4: converges)
6. Verification passes only when audit agents find no [DESIGN_DOC_OUTDATED] or [DESIGN_DOC_INCOMPLETE]
7. By A2, absence of flags implies Corresponds(Code, Doc)
8. Therefore, Corresponds(Code, Doc) holds after verification. ∎

**Part 3: Correct(Code)**

1. Audit agents check Code for bugs, edge cases, correctness (A2)
2. Diagnostics, build, tests are run (Sisyphus Verification section)
3. If ¬Correct(Code), audit agents flag issues → Sisyphus fixes → re-audit → iterate (A4: converges)
4. Non-decisional bugs are fixed by system (A3: correct classification)
5. Decisional bugs (design flaws) are escalated to user (A3), user decides fix (A1)
6. Verification passes only when audit agents find no correctness issues
7. By A2, absence of issues implies Correct(Code)
8. Therefore, Correct(Code) holds after verification. ∎

**Conclusion**: Parts 1, 2, 3 together prove `Consistent(Doc) ∧ Corresponds(Code, Doc) ∧ Correct(Code)`. QED.

---

#### Assumption Validity Discussion

**A1 (User Judgment)**: Valid if user is domain expert. Violated if user approves incorrect decisions.
- Mitigation: Momus provides detailed analysis to inform user decisions.

**A2 (Audit Completeness)**: Strong assumption. Audit agents may miss subtle issues.
- Mitigation: Multiple specialized audit agents (6 dimensions + confirmation) increase coverage.
- Limitation: Cannot guarantee 100% detection; proof shows correctness *given* A2 holds.

**A3 (Classification Correctness)**: Conservative bias (over-classify as decisional) is safe but reduces leverage.
- Mitigation: Sisyphus prompt provides explicit classification criteria.
- Limitation: Misclassifying decisional as non-decisional is a critical failure (system makes wrong decision silently).

**A4 (Convergence)**: Enforced by hard limits (3 rejections, 20 rounds).
- Limitation: Limits may be too low for complex projects; escalation to user is fallback.

**A5 (Enforcement)**: Relies on Sisyphus prompt compliance.
- Mitigation: Audit agents flag violations; UltraWork mode has explicit enforcement stages.
- Limitation: If Sisyphus deviates from prompt, proof doesn't hold.

---

### Implications for System Design

This proof-based foundation drives OMPV2's architectural choices:

1. **Two-Stage Workflow**: Stage 1 establishes Consistent(Doc) before Stage 2 expansion (Part 1 of proof).
2. **Documentation-First Principle**: Ensures Doc is correct before Code implementation (prerequisite for Part 2).
3. **Mandatory Verification**: Code-doc alignment verification is non-optional (Part 2 requires it).
4. **Decisional Classification**: Separates user effort (decisional) from system effort (non-decisional) to maximize leverage.
5. **Audit Agent Diversity**: Multiple specialized agents increase A2 validity (detection coverage).
6. **Hard Limits**: 3-rejection and 20-round limits enforce A4 (convergence).

**User Leverage in Practice**: User reviews ~50-line Stage 1 form and ~500-line Stage 2 document, approves 5-10 decisional items. System autonomously verifies 5,000-line codebase against documentation. User effort: O(decisional items). System effort: O(codebase size).

## System Overview

OMPV2 is a thin orchestration runtime (~4600 lines) that extends pi's Sisyphus agent with behavioral hooks, task management, and quality enforcement. It delegates all execution to external extensions:

- **pi-subagents**: Code execution, file operations, diagnostics
- **pi-web-access**: Web search, content fetching
- **pi-mcp-adapter**: MCP protocol integration

**Core Philosophy**: Sisyphus orchestrates, does not execute. OMPV2 provides the orchestration framework.

**Evolution from V1**: V1 was a monolithic 7700-line system with in-house tools. V2 strips this to a thin runtime focused on:
- Agent personas and behavioral hooks
- Task management and boulder loop
- Quality enforcement (verification, scope discipline)
- Methodology integration (Hoare logic, workflow.md)

---

## Sisyphus: The Orchestrator

### Core Identity

**Sisyphus** is the primary agent persona in OMPV2. Named after the Greek myth of endless labor, Sisyphus embodies disciplined, methodical work orchestration.

**Key Principle**: Sisyphus **orchestrates**, does not execute.
- Sisyphus decomposes tasks, delegates to specialists, verifies results
- Sisyphus does NOT write all code itself — it coordinates the right agents for each subtask
- Sisyphus enforces quality through behavioral hooks, not by doing everything manually

### Three Core Responsibilities

#### 1. Task Decomposition and Ordering

Sisyphus breaks down user requests into atomic, verifiable steps:
- **Atomic**: Each step has clear success criteria
- **Ordered**: Dependencies are explicit (Step B requires Step A)
- **Verifiable**: Each step produces evidence (diagnostics, test output, functional demo)

**Example**:
```
User: "Add JWT auth to the API"

Sisyphus decomposes:
1. Check design docs for auth architecture (if missing → create design first)
2. Implement token generation (verify: token validates correctly)
3. Add auth middleware (verify: protected routes reject unauthenticated requests)
4. Update tests (verify: auth tests pass)
5. Update docs (verify: ARCHITECTURE.md reflects new auth flow)
```

#### 2. Decisional vs Non-Decisional Classification

Sisyphus separates work into two categories:

**Decisional** (requires user judgment):
- Architectural choices ("Should we use JWT or session cookies?")
- API design ("Should this be a query param or request body?")
- Tradeoff decisions ("Optimize for speed or memory?")
- Ambiguous requirements ("What should happen if X fails?")

**Non-Decisional** (confident autonomous execution):
- Bug fixes with clear root cause
- Implementation following established patterns
- Refactoring with preserved behavior
- Documentation updates for clarity

**Why this matters**: Sisyphus auto-executes Non-Decisional work, surfaces Decisional items for user review. This maximizes forward motion while respecting user authority.

#### 3. Delegation Strategy

Sisyphus delegates based on three principles:

**Principle 1: Perspective** — Task requires unbiased judgment
- Example: Self-review → delegate to `oracle` (independent perspective)
- Example: Audit own code → delegate to dimension auditors (fresh eyes)

**Principle 2: Capability** — Task requires abilities Sisyphus lacks
- Example: PDF analysis → delegate to `multimodal-looker`
- Example: Deep research → delegate to `librarian` (external docs)

**Principle 3: Efficiency** — Task is context-independent + multi-step complex
- Example: Parallel codebase search → delegate to 2-5 `explore` agents
- Example: Multi-dimensional audit → delegate to 6 dimension auditors in parallel

**Anti-pattern**: Reflexive delegation ("always delegate X") without checking if Sisyphus can do it efficiently.

### Decision-Making Logic

Sisyphus uses a structured decision process:

#### Phase 0: Intent Classification

Classify user request into one of 8 types:
1. **Trivial** (< 5 min, single file) → Execute immediately
2. **Simple** (5-15 min, clear scope) → 1-2 clarifying questions max
3. **Refactoring** (preserve behavior) → Verify test coverage first
4. **Build** (new feature) → Verify requirements, identify integration points
5. **Mid-Sized** (1-4 hours) → Deep interview, verify assumptions
6. **Collaborative** (ambiguous scope) → Exploratory interview, propose approach
7. **Architecture** (multi-system) → Multi-round interview, research patterns
8. **Research** (unknown scope) → Define research questions, set boundaries

#### Phase 1: Ambiguity Check

- **Single valid interpretation** → Proceed
- **Multiple interpretations, similar effort** → Proceed with reasonable default, note assumption
- **Multiple interpretations, 2x+ effort difference** → MUST ask
- **Missing critical info** → MUST ask

#### Phase 2: Documentation Check (MANDATORY)

Before ANY code change:
1. Check if design documentation exists (`docs/ARCHITECTURE.md`)
2. If outdated/incomplete/missing → Update docs FIRST
3. Only then proceed to code changes

**Why**: Documentation is the source of truth. Code without design docs leads to drift.

#### Phase 3: Execution

- **Non-Decisional** → Execute autonomously, verify, report
- **Decisional** → Surface to user, await confirmation, then execute

### Behavioral Enforcement

Sisyphus enforces quality through 9 behavioral hooks:

1. **sisyphus-prompt.ts**: Injects orchestration persona and code enforcement rules (see L72-92 for 200 LOC limit, single responsibility principle)
2. **boulder.ts**: Auto-restarts if actionable tasks remain (with boulder-countdown.ts and boulder-helpers.ts)
3. **comment-checker.ts**: Detects lazy code comments (TODO without context, "fix this", etc.)
4. **context-recovery.ts**: Recovers session context after interruptions
5. **custom-compaction.ts**: Compresses session history
6. **edit-error-recovery.ts**: Auto-retries failed edits
7. **rules-injector.ts**: Injects project-specific code rules
8. **tool-output-truncator.ts**: Limits tool output to 100K chars
9. **ultrawork-prompt.ts**: Injects UltraWork maximalist loop

**Key insight**: Hooks modify Sisyphus behavior at runtime, not through prompt engineering alone.

### Context Mode Strategy

Sisyphus chooses context mode when delegating:

**Fork Mode** (`context: "fork"`):
- Agent inherits full parent session history
- Use when: Design review, refactoring, architecture decisions
- Why: Avoids redundant context transmission

**Fresh Mode** (`context: "fresh"`):
- Agent starts with clean slate
- Use when: Independent audit, fresh perspective, isolated analysis
- Why: Prevents context contamination

**Decision matrix**:
| Task | Mode | Rationale |
|------|------|----------|
| Design review | fork | Needs architecture context |
| Independent audit | fresh | Must avoid bias |
| Refactoring | fork | Needs codebase understanding |
| Parallel search | fresh | Independent exploration |

### Anti-Patterns Sisyphus Prevents

1. **Silent scope reduction** — Never quietly deliver reduced version when hitting blockers
2. **Shotgun debugging** — No random changes hoping something works
3. **Type-only verification** — "Types check out" doesn't prove functionality
4. **Batch task completion** — Mark tasks done immediately, not in batches
5. **Reflexive delegation** — Don't delegate simple work that Sisyphus can do
6. **Documentation drift** — Never change code without updating design docs

### Sisyphus in UltraWork Mode

In UltraWork, Sisyphus becomes a maximalist orchestrator:

**Stage 0**: Detect design intent from docs (if incomplete → Stage 1)
**Stage 1**: Create/update design docs BEFORE implementation
**Stage 2**: Implementation following documented design
**Stage 3**: 9-step audit loop (Sisyphus pushes the loop, not a sub-agent)
**Stage 4**: Completion report (Decisional vs Non-Decisional)

**Why Sisyphus pushes the loop**: Delegation to another agent → too long + async uncontrollable. Sisyphus is the main agent, loop progression is its job.

### Summary

Sisyphus is OMPV2's orchestration engine:
- **Decomposes** tasks into atomic, verifiable steps
- **Classifies** work as Decisional (user judgment) vs Non-Decisional (autonomous)
- **Delegates** strategically based on perspective, capability, efficiency
- **Enforces** quality through behavioral hooks and code rules (see `sisyphus-prompt.ts:L72-92` for 200 LOC limit, single responsibility principle)
- **Verifies** functionally, not just statically
- **Documents** design decisions before code changes (see `sisyphus-prompt.ts:L352-410` for Documentation-First Principle: Check Doc → Audit Doc → Update Doc → Implement Code → Verify Correspondence)
- **Routes context** intelligently (see `sisyphus-prompt.ts:L412-485` for Fork Strategy: use `context: "fork"` when task needs parent context, `context: "fresh"` for independent audits)

Sisyphus doesn't do everything — it coordinates the right agents to do the right work at the right time.

---

## Configuration System

OMPV2 uses a two-tier configuration system to customize agent routing, model selection, and system behavior.

### Configuration Files

- **User-level**: `~/.pi/oh-my-pi.jsonc` — Global defaults for all projects
- **Project-level**: `.pi/oh-my-pi.jsonc` — Project-specific overrides (takes precedence)
- **Format**: JSONC (JSON with comments and trailing commas)

### Configuration Schema

```jsonc
{
  // Category definitions (per-key shallow merge with defaults)
  "categories": {
    "visual-engineering": {
      "model": "claude-sonnet-4-6",
      "agent": "sisyphus-junior",
      "description": "Frontend/UI work",
      "fallbackModels": ["claude-opus-4"]
    }
    // ... 7 more default categories
  },
  
  // Disabled agents (union of user + project configs)
  "disabled_agents": ["agent-name"],
  
  // Default model for unspecified tasks
  "default_model": "claude-sonnet-4-6",
  
  // Boulder loop auto-restart
  "boulder_enabled": true,
  
  // Code enforcement rules (200 LOC limit, etc.)
  "sisyphus_rules_enabled": true
}
```

### Default Categories

OMPV2 defines 8 categories that guide Sisyphus's delegation decisions:

| Category | Default Model | Agent | Domain |
|----------|--------------|-------|--------|
| `visual-engineering` | claude-sonnet-4-6 | sisyphus-junior | UI/CSS/frontend/design |
| `ultrabrain` | claude-opus-4 | sisyphus-junior | Complex logic/architecture |
| `deep` | claude-sonnet-4-6 | hephaestus | Autonomous research + implementation |
| `artistry` | claude-sonnet-4-6 | sisyphus-junior | Creative/artistic tasks |
| `quick` | claude-haiku-4-5 | sisyphus-junior | Single-file trivial fixes |
| `unspecified-low` | claude-sonnet-4-6 | sisyphus-junior | Moderate effort tasks |
| `unspecified-high` | claude-opus-4 | sisyphus-junior | Large cross-system work |
| `writing` | claude-sonnet-4-6 | sisyphus-junior | Documentation/technical writing |

**Key insight**: Categories are advisory data for Sisyphus's prompt. The LLM makes the final routing decision based on task domain matching.

### Configuration Merging

- **categories**: Per-key shallow merge (project overrides user for matching keys)
- **disabled_agents**: Union (project + user)
- **Other fields**: Project config completely overrides user config

### Implementation

See `config.ts:L1-242` for:
- JSONC parser (strips comments, removes trailing commas)
- Default category definitions (L15-82)
- Configuration loading and merging logic
- `getCategory()` function for runtime category resolution

---

## Component Hierarchy

### Directory Structure

```
oh-my-pi-v2/
├── agents/           # Agent persona definitions (18 agents)
│   ├── prometheus.md           # Stage 1: Requirements elicitation
│   ├── momus.md               # Stage 2: Design review (3 roles)
│   ├── atlas.md               # Master orchestrator
│   ├── oracle.md              # Read-only architecture consultant
│   ├── explore.md             # Codebase search specialist
│   ├── librarian.md           # External docs search
│   ├── metis.md               # Pre-planning consultant
│   ├── hephaestus.md          # Deep autonomous worker
│   ├── sisyphus-junior.md     # Execution agent
│   ├── multimodal-looker.md   # Media analysis
│   ├── *-auditor.md           # 6 dimension auditors + 2 meta-auditors
│   └── workflow-auditor.md    # Process discipline auditor
├── commands/         # User-facing commands (4 commands)
│   ├── start-work.ts          # Two-stage workflow orchestration
│   ├── ultrawork.ts           # 4-stage UltraWork execution
│   ├── review-plan.ts         # Plan review interface
│   └── consult.ts             # Oracle consultation
├── hooks/            # Behavioral hooks (11 hooks)
│   ├── boulder.ts             # Auto-restart loop
│   ├── sisyphus-prompt.ts     # Sisyphus persona injection
│   ├── ultrawork-prompt.ts    # UltraWork mode injection
│   ├── rules-injector.ts      # Rule enforcement
│   └── ...                    # Error recovery, compaction, etc.
├── tools/            # Task management system (5 modules)
│   ├── task.ts                # Task tool implementation
│   ├── task-state-entry.ts    # State persistence
│   └── ...                    # Helpers, renderers, actions
├── skills/           # Specialized workflows (2 skills)
│   ├── github-triage/         # Issue/PR analysis
│   └── pre-publish-review/    # Multi-agent review
├── references/       # Methodology documents (4 docs)
│   ├── workflow.md            # Overall process
│   ├── hoare-design.md        # Design tools
│   ├── hoare-prompt.md        # Hoare logic methodology
│   └── hoare-audit.md         # 9-step audit framework
└── docs/             # Architecture documentation
    ├── ARCHITECTURE.md        # This document
    ├── design-intent.md       # Design philosophy
    └── deployment-guide.md    # Deployment instructions
```

### Agent Hierarchy

OMPV2 defines 18 specialized agents organized into functional layers:

**Orchestration Layer** (coordination, no execution):
- **atlas**: Master orchestrator, delegates all implementation, verifies results
- **sisyphus** (base): Enhanced by OMPV2 hooks, drives boulder loop

**Planning Layer** (requirements and design):
- **prometheus**: Requirements elicitation, intent classification, Stage 1 form generation
- **momus**: Design review, 3 roles (Gate 1 gatekeeper, Stage 2 collaborator, Final self-reviewer)
- **metis**: Pre-planning consultant, identifies hidden intentions and ambiguities

**Execution Layer** (implementation):
- **sisyphus-junior**: General execution agent for delegated subtasks
- **hephaestus**: Deep autonomous worker for complex long-running tasks

**Search Layer** (information retrieval):
- **explore**: Codebase search specialist, finds files/patterns/implementations
- **librarian**: External documentation and open-source codebase search
- **oracle**: Read-only architecture consultant for debugging and design

**Analysis Layer** (specialized analysis):
- **multimodal-looker**: Media file analysis (PDFs, images, diagrams)

**Audit Layer** (verification):
- **6 Dimension Auditors**: crash-safety, functional-correctness, cross-boundary, resource, spec-impl, adversarial
- **confirmation-auditor**: Independent confirmation with fresh eyes (Step 4 of hoare-audit)
- **workflow-auditor**: Process discipline auditor (checks adherence to workflow.md)

### Agent Discovery Mechanism

OMPV2 agents are made discoverable to pi-subagents through symbolic linking:

**Implementation** (`subagent-links.ts`):
1. On extension activation, OMPV2 creates symlinks from `agents/*.md` to `~/.pi/agent/agents/`
2. pi-subagents scans `~/.pi/agent/agents/` to discover available agents
3. Sisyphus can then delegate to OMPV2 agents via `subagent({agent: "prometheus", task: "..."})`

**Uninstallation Note**: If you uninstall OMPV2, manually delete symlinks in `~/.pi/agent/agents/` to avoid stale references. OMPV2 does not auto-cleanup on uninstall.

### Command System

OMPV2 exposes 4 user-facing commands:

**Primary Workflows**:
- **/omp-start**: Two-stage workflow (Prometheus + Momus), generates design documents
- **/omp-ultrawork**: 4-stage UltraWork execution (Stage 0: design intent detection, Stage 1: design, Stage 2: implementation, Stage 3: audit loop)

**Auxiliary Commands**:
- **/omp-review**: Review existing design plans in `.pi/oh-my-pi-plans/`
- **/omp-consult**: Direct Oracle consultation for architecture questions

### Hook System

OMPV2 uses 11 behavioral hooks to modify Sisyphus behavior:

**Core Behavior**:
- **boulder.ts**: Auto-restart loop (continues if tasks remain in_progress or ready)
- **boulder-countdown.ts**: Countdown display before restart
- **sisyphus-prompt.ts**: Injects Sisyphus orchestration persona
- **ultrawork-prompt.ts**: Injects UltraWork mode instructions

**Quality Enforcement**:
- **rules-injector.ts**: Injects project-specific rules (AGENTS.md, workflow.md)
- **comment-checker.ts**: Detects lazy code comments (TODO without context, "fix this", etc.)

**Error Recovery**:
- **edit-error-recovery.ts**: Recovers from edit tool failures
- **context-recovery.ts**: Recovers from context overflow

**Optimization**:
- **custom-compaction.ts**: Custom impression distillation
- **tool-output-truncator.ts**: Truncates verbose tool outputs

### Task Management System

OMPV2 implements a custom task management tool (5 modules):

- **task.ts**: Tool implementation (list, add, start, done, expire, clear, update_deps)
- **task-state-entry.ts**: State persistence to `.pi/task-state.json`
- **task-helpers.ts**: Utility functions (dependency resolution, validation)
- **task-renderers.ts**: TUI rendering (task list, dependency graph)
- **task-actions.ts**: Action handlers (start, done, expire, etc.)

**Key Features**:
- Dependency tracking (blocks/blockedBy relationships)
- State transitions (pending → in_progress → completed/expired)
- Boulder loop integration (auto-restart if tasks remain in_progress or ready)


## Two-Stage Workflow Design

The two-stage workflow (`/omp-start`) is OMPV2's core design process. It addresses the fundamental problem: **users often don't know what they want until they see a concrete design**.

### Design Evolution: Why Two Stages?

**Historical Context**: The original Prometheus was a monolithic 943-line agent that combined requirements elicitation, design generation, and verification. Analysis revealed ~40% unique value (interview, intent classification, scheduling) and ~60% overlap with the Hoare pipeline (verification, QA, guardrails).

**Restructuring Decision** (documented in `/tmp/omp-start-vs-hoare.md`):
- **Keep**: Prometheus's unique value (active requirements elicitation, intent classification, execution scheduling)
- **Remove**: Verification and QA (superseded by Hoare pipeline)
- **Add**: Momus as a lightweight reviewer (3 distinct roles)

**Why Not Single-Stage?**: A single-stage design forces users to commit to all design decisions upfront. This fails because:
1. Users discover requirements during design exploration
2. Design decisions reveal hidden constraints
3. Ambiguities only surface when concrete designs are proposed

**Two-Stage Solution**:
- **Stage 1**: Lightweight intent confirmation (YAML form, ~5 minutes)
- **Gate 1**: Strict gatekeeper (APPROVED/APPROVED_WITH_WARNINGS/REJECTED)
- **Stage 2**: Iterative design document collaboration (Markdown doc, multiple rounds)
- **Collaborative Review**: Momus appends findings after each round
- **Final Self-Review**: Momus assesses completeness when Prometheus declares "no pending decisions"

### Stage 1: Intent Confirmation Form

**Purpose**: Capture user intent quickly without forcing premature design decisions.

**Prometheus Role**: Interviewer and planner (not implementer).

**Output Format**: YAML form with 4 sections:

```yaml
intent:
  what: "What are we building?"
  why: "Why does this matter?"
  success_criteria: "How do we know when we're done?"

design_approach:
  how: "High-level approach (1-2 sentences)"

components:
  - name: "Component name"
    intent: "What does this component do?"

sanity_check:
  - "Pre-flight question 1?"
  - "Pre-flight question 2?"
```

**Interview Strategy**: Prometheus classifies intent into 8 types (Trivial, Simple, Refactoring, Build, Mid-Sized, Collaborative, Architecture, Research) and adjusts interview depth accordingly.

**Clearance Checklist**: Before generating the form, Prometheus must clear 6 items:
1. **Objective**: What are we building and why?
2. **Scope**: What's in/out of scope?
3. **Ambiguities**: What's unclear or underspecified?
4. **Approach**: High-level strategy?
5. **Test Strategy**: How will we verify correctness?
6. **Blocking Questions**: What must be resolved before starting?

**High Accuracy Mode**: Prometheus runs a mandatory self-review loop before handing off to Momus Gate 1.


### Gate 1: Momus Gatekeeper

**Purpose**: Strict approval/rejection gate to prevent garbage-in-garbage-out.

**Momus Role 1**: Gatekeeper (not collaborator, not implementer).

**Three Outcomes**:
- **APPROVED**: Form is clear, complete, and actionable
- **APPROVED_WITH_WARNINGS**: Minor issues but not blocking (weak sanity check, granularity issues)
- **REJECTED**: Critical issues that prevent design work (unclear intent, unmeasurable success, missing design approach, contradictions, scope explosion)

**Rejection Loop**: Maximum 3 rejection cycles. After 3 rejections, the workflow terminates (user must restart with clearer requirements).

**Impatience Detection**: Momus detects user frustration signals (short responses, "just approve it", "good enough") and approves despite issues to avoid blocking the user.

**Why Strict?**: Gate 1 is the last checkpoint before expensive design work. Approving a bad form wastes hours of Stage 2 iteration.

**Output Format**: YAML with status, reasoning, and specific issues:

```yaml
status: APPROVED | APPROVED_WITH_WARNINGS | REJECTED
reasoning: "Why this decision?"
issues:
  critical: ["Issue 1", "Issue 2"]  # Only for REJECTED
  warnings: ["Warning 1"]           # Only for APPROVED_WITH_WARNINGS
```

### Stage 2: Design Document Collaboration

**Purpose**: Iterative design refinement with continuous feedback.

**Prometheus Role**: Design document generator (not implementer, not reviewer).

**Output Format**: Markdown document with 8 sections:

```markdown
# Intent
(Expanded from Stage 1 YAML)

# Design Approach
(Detailed strategy)

# Components
## Component 1
- Intent: What does this do?
- Pre-conditions: (optional, Hoare logic)
- Post-conditions: (optional, Hoare logic)
- Invariants: (optional, Hoare logic)

# Decisions Log
## [DECISION] Decision Title
- Context: Why is this a decision point?
- Options: What are the alternatives?
- Tradeoffs: What are the pros/cons?
- Recommendation: What do we suggest?

## [NON-DECISION] Non-Decision Title
- Why this is not a decision: Single reasonable approach / constrained by codebase / trivial detail

# Open Questions
(Unresolved questions that need user input)

# Scope
(What's in/out of scope)

# Momus Review - Round N
(Momus appends findings here after each round)

# Momus Final Self-Review
(Momus appends final assessment here)
```


### Decision Point Marking System

**Purpose**: Distinguish genuine decision points from implementation details.

**Two Categories**:

**[DECISION]**: Requires user judgment because:
- Multiple valid approaches exist with different tradeoffs
- Unclear direction (ambiguous requirements)
- Significant downstream impact (affects multiple components)

**[NON-DECISION]**: Does not require user judgment because:
- Single reasonable approach (obvious choice)
- Constrained by existing codebase (no alternatives)
- Trivial implementation detail (low impact)

**Why Track Non-Decisions?**: Momus extracts hidden decision points from the non-decision list. What Prometheus considers "obvious" may actually be a decision point when examined critically.

**Momus Role 2 Principle**: "Mover, not blocker". Momus never rejects Stage 2 documents. Instead, it appends findings to the document and lets Prometheus/user decide how to proceed.

### Collaborative Review Loop

**Trigger**: After each Prometheus round (document expansion).

**Momus Role 2**: Collaborative reviewer (not gatekeeper, not implementer).

**Evaluation Focus**:
1. **Hidden Decisions**: Audit the [NON-DECISION] list using semantic understanding (not keyword matching). Is this truly obvious/constrained/trivial?
2. **Ambiguities**: Identify vague language, undefined terms, missing constraints
3. **Completeness**: Check if all components are specified, all decisions are justified

**Output Format**: Momus appends findings to the document under `# Momus Review - Round N`:

```markdown
# Momus Review - Round 1

## Hidden Decision Points
- [NON-DECISION] "Use REST API" → Actually a decision (GraphQL vs REST vs gRPC)

## Ambiguities
- "Handle errors gracefully" → What does "gracefully" mean? Retry? Fallback? User notification?

## Completeness Gaps
- Component "Database Layer" has no Pre/Post conditions
- Missing test strategy for concurrent access
```

**User Interaction**: After each round, the user can:
- Provide feedback (injected into next Prometheus round)
- Type "continue" (Prometheus continues without feedback)
- Type "done" (triggers Final Self-Review)
- Terminate the session (Ctrl+C)

**Maximum Rounds**: 20 rounds (prevents runaway expansion).


### Final Self-Review

**Trigger**: Prometheus declares "no pending decision points" or user types "done".

**Momus Role 3**: Final self-reviewer (not gatekeeper, not implementer).

**Evaluation Focus**:
1. **Decision Completeness**: Are all decision points resolved? Any hidden decisions remaining?
2. **Granularity Assessment**: Is every leaf node self-contained and actionable? Can implementation start without further design decisions?
3. **Scope Alignment**: Does the design match the original intent from Stage 1?

**Three Recommendations**:
- **END**: Design is complete and actionable, ready for implementation
- **EXPAND**: Design needs more detail (specific components underspecified)
- **SUPPLEMENT**: Design needs additional sections (missing test strategy, missing error handling, etc.)

**Inform, Not Enforce**: Momus recommendations can be overridden by Prometheus or the user. Momus informs, does not enforce.

**Output Format**: Momus appends final assessment to the document under `# Momus Final Self-Review`:

```markdown
# Momus Final Self-Review

## Assessment
- Decision Completeness: ✓ All decisions resolved
- Granularity: ✗ Component "Auth Layer" needs more detail
- Scope Alignment: ✓ Matches Stage 1 intent

## Recommendation
EXPAND

## Reasoning
Component "Auth Layer" is underspecified. "Use JWT tokens" is not actionable without:
- Token structure (claims, expiration)
- Refresh token strategy
- Revocation mechanism
```

**User Decision**: After Final Self-Review, the user decides:
- Accept the recommendation (continue or end)
- Override the recommendation (end despite EXPAND/SUPPLEMENT)
- Provide feedback and continue iteration


## State Persistence and Resume

### State Files

OMPV2 persists workflow state to enable resume after interruption:

**State File**: `.pi/oh-my-pi-state.json`
```typescript
interface WorkState {
  activePlan: string;           // Plan name (safe filename)
  stage: 'stage1' | 'stage2';   // Current stage
  round: number;                // Stage 2 round counter
  gate1Rejections: number;      // Gate 1 rejection counter
  createdAt: string;            // ISO timestamp
  lastUpdatedAt: string;        // ISO timestamp
}
```

**Plan Files**: `.pi/oh-my-pi-plans/<safeName>.md`
- Stage 1: Contains YAML form
- Stage 2: Contains Markdown document (updated each round)

### Resume Mechanism

**Command**: `/omp-start --resume`

**Resume Logic**:
1. Load `WorkState` from `.pi/oh-my-pi-state.json`
2. Load plan document from `.pi/oh-my-pi-plans/<activePlan>.md`
3. Detect current stage:
   - If `stage === 'stage1'`: Resume Stage 1 (Prometheus continues form generation)
   - If `stage === 'stage2'`: Resume Stage 2 (Prometheus continues document expansion)
4. Continue from current round (no re-execution of completed rounds)

**Why Resume?**: Design sessions can span hours or days. Resume enables:
- Interruption recovery (Ctrl+C, system crash, network failure)
- Multi-day design sessions (pause overnight, resume next day)
- Experimentation (try different approaches, revert if needed)

### Stage Detection Logic

**Stage 1 Form Detection** (`isStage1FormReady`):
- Checks for YAML structure: `intent:`, `design_approach:`, `components:`
- Validates required fields are present
- Returns `true` if form is complete

**Stage 2 Document Detection** (`isStage2DocReady`):
- Checks for Markdown headers: `# Intent`, `# Design Approach`, `# Components`
- Validates document structure
- Returns `true` if document is ready for Momus review

**Prometheus Completion Detection** (`prometheusDeclaresComplete`):
- Pattern matching on Prometheus output:
  - "no pending decision points"
  - "ready for final self-review"
  - "design is complete"
- Returns `true` if Prometheus signals completion


## Orchestration Implementation

### Momus Spawning Pattern

**Key Design Decision**: Momus is spawned in separate sessions for each role, not as a persistent agent.

**Why Separate Sessions?**:
1. **Role Isolation**: Each Momus role (Gate 1, Collaborative Review, Final Self-Review) has different instructions and context requirements. Separate sessions prevent role confusion.
2. **Context Management**: Each session starts with fresh context (only the relevant document/form). This prevents context pollution from previous rounds.
3. **Immediate Disposal**: Sessions are disposed immediately after use, freeing resources.

**Spawning Logic** (from `start-work.ts`):

```typescript
// Gate 1 Gatekeeper
const gate1Session = await createAgentSession({
  agent: 'momus',
  task: `Review Stage 1 form:\n${stage1Form}`,
  context: 'fresh'
});
const gate1Response = await gate1Session.run();
gate1Session.dispose();

// Stage 2 Collaborative Review
const reviewSession = await createAgentSession({
  agent: 'momus',
  task: `Review Stage 2 document (Round ${round}):\n${stage2Doc}`,
  context: 'fresh'
});
const reviewResponse = await reviewSession.run();
reviewSession.dispose();

// Final Self-Review
const finalSession = await createAgentSession({
  agent: 'momus',
  task: `Final self-review:\n${stage2Doc}`,
  context: 'fresh'
});
const finalResponse = await finalSession.run();
finalSession.dispose();
```

**Alternative Considered**: Persistent Momus session across all rounds. Rejected because:
- Role confusion (Gate 1 vs Collaborative Review vs Final Self-Review)
- Context accumulation (previous rounds pollute current round)
- Resource waste (session remains active between rounds)

### Limits and Safeguards

**MAX_GATE1_REJECTIONS = 3**: Prevents infinite rejection loops. After 3 rejections, the workflow terminates. User must restart with clearer requirements.

**MAX_STAGE2_ROUNDS = 20**: Prevents runaway expansion. After 20 rounds, the workflow terminates. User must review and decide whether to continue manually.

**Why These Limits?**:
- **Gate 1**: If Momus rejects 3 times, the form is fundamentally flawed. Further iteration is unlikely to fix it.
- **Stage 2**: If 20 rounds don't produce a complete design, the problem is too complex for this workflow. User should break it down or use a different approach.


## UltraWork 4-Stage Execution

UltraWork (`/omp-ultrawork`) is OMPV2's comprehensive execution framework. It integrates design, implementation, and verification into a single workflow.

### Stage 0: Design Intent Detection

**Purpose**: Detect whether the user's request requires design work before implementation.

**Mechanism**: Parallel explore agents search the codebase from multiple angles to assess:
- Complexity (how many files/components affected?)
- Novelty (is this a new pattern or extending existing patterns?)
- Ambiguity (are requirements clear or underspecified?)

**Outcomes**:
- **Design Intent Detected**: Proceed to Stage 1 (design phase)
- **No Design Intent**: Skip to Stage 2 (implementation phase)

**Why Parallel Explore?**: Single-angle search misses context. Parallel search from 2-4 angles provides comprehensive coverage.

### Stage 1: Design Phase

**Trigger**: Design intent detected in Stage 0.

**Mechanism**: Delegates to `hoare-design.md` methodology.

**Output**: Design document with:
- Pre-conditions, Post-conditions, Invariants (Hoare logic contracts)
- Component specifications
- Decision log
- Test strategy

**Integration with /omp-start**: Stage 1 can optionally use the two-stage workflow (Prometheus + Momus) for complex designs. For simpler designs, it uses a streamlined single-agent approach.

### Stage 2: Implementation Phase

**Trigger**: Stage 1 complete (or Stage 0 detected no design intent).

**Mechanism**: Delegates to `workflow.md` §4 (implementation process).

**Key Principles**:
- Minimal code changes (only what's needed)
- Functional verification (not just diagnostics/types)
- Scope discipline (no silent downscoping)

**Verification Requirements** (from `design-intent.md`):
- CLI commands: Must be run and output verified
- Build outputs: Must be generated and inspected
- APIs: Must be called and responses validated
- UI: Must be rendered and visually inspected

### Stage 3: Audit Loop

**Trigger**: Stage 2 complete (implementation done).

**Mechanism**: Sisyphus orchestrates the 9-step `hoare-audit.md` framework.

**9-Step Framework**:
1. **Dimension Selection**: Sisyphus selects relevant audit dimensions (crash-safety, functional-correctness, cross-boundary, resource, spec-impl, adversarial)
2. **Parallel Audit**: Selected dimension agents audit in parallel
3. **Findings Aggregation**: Sisyphus collects and deduplicates findings
4. **Confirmation Audit**: confirmation-auditor provides independent verification with fresh eyes
5. **Workflow Audit**: workflow-auditor checks adherence to `workflow.md`
6. **Decisional Classification**: Sisyphus separates findings into Decisional (requires user judgment) vs Non-Decisional (confident fixes)
7. **Fix Implementation**: Sisyphus implements Non-Decisional fixes
8. **User Review**: Sisyphus presents Decisional findings to user
9. **Iteration**: Repeat until no findings remain

**Why 9 Steps?**: Each step has a specific purpose. Skipping steps leads to incomplete audits.


### Stage 4: Completion Report

**Trigger**: Stage 3 complete (audit loop finished).

**Mechanism**: Sisyphus generates a completion report separating Decisional vs Non-Decisional items.

**Two Buckets**:

**Non-Decisional** (confident, completed, no user input needed):
- Work done with clear outcomes
- Brief summary, no over-explanation

**Decisional** (requires user judgment):
- All marked decision points from the task system
- Any overlooked decision points discovered during execution
- For each: state the situation, tentative view, what decision is needed

**Why Separate?**: Users don't want to wade through implementation details. They want to know:
1. What's done? (Non-Decisional)
2. What needs my judgment? (Decisional)

## Prometheus Three-Role Design

Prometheus operates in three distinct modes depending on the workflow stage:

### Role 1: Interviewer (Stage 1)

**Purpose**: Elicit user intent through active questioning.

**Tools**: Read-only (bash, read, web_search, code_search, fetch_content)

**Output**: Stage 1 YAML form

**Interview Strategy**:
- Classify intent into 8 types (Trivial, Simple, Refactoring, Build, Mid-Sized, Collaborative, Architecture, Research)
- Adjust interview depth based on classification
- Use clearance checklist (Objective, Scope, Ambiguities, Approach, Test Strategy, Blocking Questions)

**Key Principle**: Ask questions, don't assume. Users often don't know what they want until asked.

### Role 2: Planner (Stage 2)

**Purpose**: Generate and expand design documents.

**Tools**: Read-only (bash, read, web_search, code_search, fetch_content)

**Output**: Stage 2 Markdown document

**Planning Strategy**:
- Start with high-level design approach
- Expand components with Pre/Post/Invariants (optional)
- Mark decision points ([DECISION] vs [NON-DECISION])
- Respond to Momus feedback (incorporate findings into next round)

**Key Principle**: Design, don't implement. Prometheus generates design documents, not code.

### Role 3: Document Generator (UltraWork Stage 1)

**Purpose**: Generate design documents for UltraWork execution.

**Tools**: Read-only (bash, read, web_search, code_search, fetch_content)

**Output**: Design document with Hoare logic contracts

**Generation Strategy**:
- Use `hoare-design.md` methodology
- Generate Pre/Post/Invariants for all components
- Document decision log
- Specify test strategy

**Key Principle**: Formal contracts. UltraWork Stage 1 requires Hoare logic contracts for verification.


## Momus Three-Role Design

Momus operates in three distinct roles with different behaviors and constraints:

### Role 1: Stage 1 Gatekeeper

**Purpose**: Strict approval/rejection of Stage 1 YAML form.

**Behavior**: Binary decision (APPROVED vs REJECTED, with APPROVED_WITH_WARNINGS as middle ground).

**Evaluation Criteria**:
- CRITICAL issues → REJECTED: unclear intent, unmeasurable success criteria, missing design approach, contradictions, scope explosion
- MINOR issues → APPROVED_WITH_WARNINGS: weak sanity check, granularity issues, missing constraints

**Key Principle**: Gate, not collaborate. Gate 1 blocks bad designs from entering Stage 2.

**Special Behavior**: Impatience detection. If user shows frustration (short responses, "just approve it"), Momus approves despite issues to avoid blocking.

**Tradeoff**: Strict gating prevents garbage-in-garbage-out but risks blocking users who know what they want. Impatience detection mitigates this.

### Role 2: Stage 2 Collaborative Reviewer

**Purpose**: Non-blocking review that informs without enforcing.

**Behavior**: Appends findings to document, never rejects.

**Evaluation Focus**:
- Hidden decision extraction from [NON-DECISION] list (semantic understanding, not keyword matching)
- Ambiguity identification (vague language, undefined terms, missing constraints)
- Completeness checking (all components specified, all decisions justified)

**Key Principle**: "Mover, not blocker." Momus informs, Prometheus/user decides.

**Why Not Blocking?**: Stage 2 is iterative. Blocking review would slow iteration. Non-blocking review keeps the collaboration moving.

**Semantic Understanding Requirement**: Momus must use semantic understanding (not keyword matching) to evaluate non-decisions. A [NON-DECISION] marked "Use REST API" might actually be a [DECISION] if GraphQL or gRPC are viable alternatives.

### Role 3: Stage 2 Final Self-Reviewer

**Purpose**: Assess design completeness when Prometheus declares "no pending decisions."

**Behavior**: Recommends END/EXPAND/SUPPLEMENT (can be overridden).

**Evaluation Focus**:
- Decision completeness: Are all decision points resolved?
- Granularity assessment: Is every leaf node self-contained and actionable?
- Scope alignment: Does the design match the original intent from Stage 1?

**Key Principle**: "Inform, not enforce." Prometheus/user may override the recommendation.

**Granularity Check**: "Every leaf node is self-contained and actionable." This means enough detail to implement without further design decisions.

**Tradeoff**: Strict granularity prevents underspecified designs but risks over-specification (too much detail for trivial components). Momus should calibrate based on component complexity.


## Relationship with Hoare Logic

OMPV2 integrates Hoare logic methodology through four reference documents in `references/`:

### Four Methodology Documents

**hoare-prompt.md**: Core Hoare logic methodology
- Pre-conditions, Post-conditions, Invariants
- Formal reasoning about program correctness
- Counterexample requirement (prove correctness or provide counterexample)

**hoare-design.md**: Design tools using Hoare logic
- Component specification with Pre/Post/Invariants
- Decision log with formal justification
- Test strategy derived from contracts

**hoare-audit.md**: 9-step audit framework
- Dimension selection (6 audit dimensions)
- Parallel audit execution
- Findings aggregation and classification
- Confirmation audit (fresh eyes)
- Workflow audit (process discipline)

**workflow.md**: Overall process discipline
- §4: Implementation process (minimal changes, functional verification, scope discipline)
- Task management (multi-step → todos, mark done immediately)
- Delegation principles (Perspective, Capability, Efficiency)

### Three-Way Division of Labor

**Prometheus**: "WHAT do you want?"
- Requirements elicitation
- Intent classification
- Execution scheduling

**Hoare Pipeline**: "IS IT CORRECT?"
- Formal verification (Pre/Post/Invariants)
- 6-dimension parallel audit
- Counterexample requirement

**workflow.md**: "HOW do we work?"
- Process discipline
- Task management
- Delegation principles

**Why Three Systems?**: Each addresses a different concern:
- Prometheus: User doesn't know what they want → active elicitation
- Hoare: Implementation might be incorrect → formal verification
- workflow.md: Process might be undisciplined → behavioral enforcement

**Integration Point**: Prometheus output (Stage 1 form or Stage 2 document) feeds into UltraWork Stage 0, which then uses Hoare pipeline for verification.

### Design Evolution: Prometheus vs Hoare

**Historical Problem**: Original Prometheus (943 lines) had ~60% overlap with Hoare pipeline (verification, QA, guardrails).

**Restructuring Decision** (documented in `/tmp/omp-start-vs-hoare.md`):
- Strip Prometheus to core value (~40%): interview, intent classification, scheduling
- Delegate verification to Hoare pipeline
- Add Momus as lightweight reviewer (3 roles)

**Result**: Prometheus (539 lines) + Momus (441 lines) = 980 lines total, but with clear separation of concerns.

**Why Not Delete Prometheus?**: Prometheus fills a real gap that Hoare doesn't cover:
- Active requirements elicitation (Hoare assumes requirements are clear)
- Intent classification (Hoare doesn't distinguish Trivial vs Architecture)
- Execution scheduling (Hoare doesn't handle parallel waves or dependency matrices)


## Component Interaction Sequences

### Two-Stage Workflow Sequence

```
User: /omp-start "Build authentication system"
  ↓
start-work.ts: Initialize WorkState, create plan file
  ↓
Prometheus (Stage 1): Interview user, generate YAML form
  ↓
start-work.ts: Detect Stage 1 form ready (isStage1FormReady)
  ↓
Momus (Gate 1): Spawn separate session, evaluate form
  ↓
  ├─ REJECTED → Prometheus (Stage 1): Revise form (max 3 cycles)
  │   ↓
  │   └─ After 3 rejections → Terminate workflow
  │
  └─ APPROVED / APPROVED_WITH_WARNINGS
      ↓
      start-work.ts: Transition to Stage 2, update WorkState
      ↓
      Prometheus (Stage 2): Generate Markdown document
      ↓
      start-work.ts: Detect Stage 2 doc ready (isStage2DocReady)
      ↓
      ┌─────────────────────────────────────────┐
      │ Stage 2 Collaborative Loop (max 20 rounds) │
      └─────────────────────────────────────────┘
      ↓
      Momus (Collaborative Review): Spawn separate session, append findings
      ↓
      start-work.ts: Prompt user for feedback
      ↓
      User: Provide feedback / "continue" / "done"
      ↓
      ├─ Feedback → Prometheus (Stage 2): Incorporate feedback, expand document
      │   ↓
      │   └─ Loop back to Momus (Collaborative Review)
      │
      ├─ "continue" → Prometheus (Stage 2): Continue without feedback
      │   ↓
      │   └─ Loop back to Momus (Collaborative Review)
      │
      └─ "done" OR Prometheus declares complete
          ↓
          Momus (Final Self-Review): Spawn separate session, assess completeness
          ↓
          ├─ END → Workflow complete, plan saved
          │
          ├─ EXPAND → Prometheus (Stage 2): Add more detail
          │   ↓
          │   └─ Loop back to Momus (Collaborative Review)
          │
          └─ SUPPLEMENT → Prometheus (Stage 2): Add missing sections
              ↓
              └─ Loop back to Momus (Collaborative Review)
```

### UltraWork 4-Stage Sequence

```
User: /omp-ultrawork "Refactor authentication module"
  ↓
ultrawork.ts: Initialize UltraWork state
  ↓
┌──────────────────────────────────────┐
│ Stage 0: Design Intent Detection    │
└──────────────────────────────────────┘
  ↓
Parallel explore agents: Search codebase from multiple angles
  ↓
Sisyphus: Aggregate findings, assess complexity/novelty/ambiguity
  ↓
  ├─ Design Intent Detected → Proceed to Stage 1
  │
  └─ No Design Intent → Skip to Stage 2
      ↓
┌──────────────────────────────────────┐
│ Stage 1: Design Phase (if needed)   │
└──────────────────────────────────────┘
      ↓
      Delegate to hoare-design.md methodology
      ↓
      Generate design document with Pre/Post/Invariants
      ↓
┌──────────────────────────────────────┐
│ Stage 2: Implementation Phase        │
└──────────────────────────────────────┘
      ↓
      Delegate to workflow.md §4
      ↓
      Implement changes with functional verification
      ↓
┌──────────────────────────────────────┐
│ Stage 3: Audit Loop                  │
└──────────────────────────────────────┘
      ↓
      Sisyphus: Select audit dimensions (crash-safety, functional-correctness, etc.)
      ↓
      Parallel dimension agents: Audit in parallel
      ↓
      Sisyphus: Aggregate findings, deduplicate
      ↓
      confirmation-auditor: Independent verification with fresh eyes
      ↓
      workflow-auditor: Check adherence to workflow.md
      ↓
      Sisyphus: Classify findings (Decisional vs Non-Decisional)
      ↓
      Sisyphus: Implement Non-Decisional fixes
      ↓
      Sisyphus: Present Decisional findings to user
      ↓
      User: Approve fixes / Provide guidance
      ↓
      ├─ Findings remain → Loop back to dimension agents
      │
      └─ No findings → Proceed to Stage 4
          ↓
┌──────────────────────────────────────┐
│ Stage 4: Completion Report           │
└──────────────────────────────────────┘
          ↓
          Sisyphus: Generate report (Decisional vs Non-Decisional)
          ↓
          User: Review report, approve completion
```


## Design Tradeoffs

### Two-Stage vs Single-Stage Workflow

**Decision**: Use two-stage workflow (Stage 1 form + Stage 2 document) instead of single-stage.

**Tradeoffs**:
- **Pro**: Users discover requirements during design exploration. Two stages allow lightweight intent confirmation before expensive design work.
- **Pro**: Gate 1 prevents garbage-in-garbage-out. Bad forms are rejected before Stage 2.
- **Con**: Additional overhead (Stage 1 form generation, Gate 1 review). For simple tasks, this is wasted effort.
- **Con**: Context switching between stages. Users must review Stage 1 form before proceeding to Stage 2.

**Why Two Stages Won**: Single-stage forces premature commitment. Users don't know what they want until they see concrete designs. Two stages enable iterative refinement.

**Mitigation**: For simple tasks (Trivial, Simple intent types), Prometheus minimizes Stage 1 overhead with streamlined interviews.

### Momus: Separate Sessions vs Persistent Session

**Decision**: Spawn Momus in separate sessions for each role (Gate 1, Collaborative Review, Final Self-Review).

**Tradeoffs**:
- **Pro**: Role isolation. Each session has different instructions and context requirements. No role confusion.
- **Pro**: Context management. Each session starts with fresh context (only relevant document/form). No context pollution.
- **Pro**: Resource efficiency. Sessions are disposed immediately after use.
- **Con**: Session creation overhead. Each spawn requires session initialization.
- **Con**: No memory across rounds. Momus doesn't remember previous rounds (must re-read document each time).

**Why Separate Sessions Won**: Role confusion is a critical failure mode. Gate 1 must be strict, Collaborative Review must be non-blocking, Final Self-Review must be comprehensive. Mixing these roles in a persistent session leads to inconsistent behavior.

**Mitigation**: Session creation overhead is negligible (<1 second). Document re-reading is necessary anyway (document changes each round).

### [DECISION] vs [NON-DECISION] Marking

**Decision**: Track both decision points and non-decision points explicitly.

**Tradeoffs**:
- **Pro**: Momus can extract hidden decision points from non-decision list. What Prometheus considers "obvious" may actually be a decision.
- **Pro**: Explicit non-decision marking forces Prometheus to justify why something is not a decision.
- **Con**: Additional overhead. Prometheus must mark every potential decision point.
- **Con**: Risk of over-marking. Trivial details might be marked as [NON-DECISION] unnecessarily.

**Why Track Non-Decisions Won**: Hidden decision points are a major source of design flaws. Explicit non-decision marking surfaces these hidden decisions.

**Mitigation**: Momus uses semantic understanding (not keyword matching) to evaluate non-decisions. Only genuine hidden decisions are extracted.

### Strict Gate 1 vs Lenient Gate 1

**Decision**: Gate 1 is strict (REJECTED for critical issues) with impatience detection.

**Tradeoffs**:
- **Pro**: Prevents garbage-in-garbage-out. Bad forms are rejected before expensive Stage 2 work.
- **Pro**: Forces users to clarify requirements upfront.
- **Con**: Risk of blocking users who know what they want but struggle to articulate it.
- **Con**: Frustration if Gate 1 rejects repeatedly.

**Why Strict Gate 1 Won**: Stage 2 is expensive (multiple rounds, Momus reviews, user interaction). Approving a bad form wastes hours of iteration.

**Mitigation**: Impatience detection. If user shows frustration (short responses, "just approve it"), Momus approves despite issues. This prevents blocking users who are confident in their requirements.


### Prometheus: Restructure vs Delete

**Decision**: Restructure Prometheus (strip to core value) instead of deleting it.

**Tradeoffs**:
- **Pro**: Prometheus fills a real gap (user interview, intent classification, execution scheduling) that Hoare doesn't cover.
- **Pro**: Restructuring removes ~60% overlap while preserving unique value.
- **Con**: Maintaining two design systems (Prometheus + Hoare) is more complex than one.
- **Con**: Users must learn when to use `/omp-start` vs `/omp-ultrawork`.

**Why Restructure Won**: Hoare assumes requirements are clear. Many users don't have clear requirements. Prometheus's active elicitation fills this gap.

**Division of Labor**:
- Prometheus: "WHAT do you want?" (requirements elicitation)
- Hoare: "IS IT CORRECT?" (verification)
- workflow.md: "HOW do we work?" (process discipline)

### 3-Rejection Limit vs Unlimited Retries

**Decision**: Limit Gate 1 rejections to 3 cycles.

**Tradeoffs**:
- **Pro**: Prevents infinite rejection loops. After 3 rejections, the form is fundamentally flawed.
- **Pro**: Forces users to restart with clearer requirements rather than iterating on bad ones.
- **Con**: Some forms might be fixable in 4-5 iterations.
- **Con**: Frustrating for users who are close but not quite there.

**Why 3 Rejections Won**: Empirically, if 3 rounds of feedback don't fix a form, the user needs to rethink their requirements from scratch. Further iteration produces diminishing returns.

### 20-Round Limit vs Unlimited Stage 2

**Decision**: Limit Stage 2 to 20 rounds.

**Tradeoffs**:
- **Pro**: Prevents runaway expansion. Some designs grow indefinitely without convergence.
- **Pro**: Forces users to assess whether the design is genuinely progressing.
- **Con**: Complex Architecture-type tasks might need >20 rounds.

**Why 20 Rounds Won**: 20 rounds represents ~5+ hours of design work. If a design hasn't converged in 5 hours, it needs manual intervention (breaking the problem down, changing approach).

## Appendix: Terminology

| Term | Definition |
|------|-----------|
| **Boulder Loop** | Auto-restart mechanism that continues work if tasks remain in_progress or ready |
| **Decisional** | Findings that require user judgment (multiple valid approaches, unclear direction) |
| **Non-Decisional** | Findings with clear solutions that don't require user judgment |
| **Gate 1** | Strict gatekeeper between Stage 1 (form) and Stage 2 (document) |
| **Mover, Not Blocker** | Momus Role 2 principle: inform without rejecting |
| **Inform, Not Enforce** | Momus Role 3 principle: recommend without mandating |
| **Pre/Post/Invariants** | Hoare logic contracts (preconditions, postconditions, loop invariants) |
| **Stage 1** | Intent confirmation phase (YAML form generation) |
| **Stage 2** | Design document collaboration phase (Markdown document) |
| **UltraWork** | 4-stage execution framework (design intent detection → design → implementation → audit) |
| **WorkState** | Persistent state object enabling resume after interruption |

## Appendix: File Locations

| File | Purpose |
|------|---------|
| `.pi/oh-my-pi-state.json` | Workflow state persistence (activePlan, stage, round, etc.) |
| `.pi/oh-my-pi-plans/<name>.md` | Plan documents (Stage 1 YAML or Stage 2 Markdown) |
| `.pi/task-state.json` | Task management state persistence |


## Appendix: Design Evolution History

### V1 → V2 Transition

**V1 Characteristics** (7700 lines):
- Monolithic system with in-house tools
- Execution, web access, and MCP all implemented internally
- Tight coupling between orchestration and execution
- Difficult to maintain and extend

**V2 Characteristics** (~4600 lines):
- Thin orchestration runtime
- Delegates execution to pi-subagents
- Delegates web access to pi-web-access
- Delegates MCP to pi-mcp-adapter
- Focus on personas, behavioral hooks, task management

**Why Transition?**: V1's monolithic design made it difficult to evolve. Every new feature required changes across multiple layers. V2's thin runtime enables independent evolution of orchestration and execution.

### Prometheus Restructuring

**Original Prometheus** (943 lines):
- Combined requirements elicitation, design generation, and verification
- ~40% unique value (interview, intent classification, scheduling)
- ~60% overlap with Hoare pipeline (verification, QA, guardrails)

**Restructured Prometheus** (539 lines):
- Stripped to core value: interview, intent classification, scheduling
- Verification delegated to Hoare pipeline
- Momus added as lightweight reviewer (441 lines)

**Why Restructure?**: Analysis revealed significant overlap with Hoare pipeline. Restructuring eliminates duplication while preserving unique value.

### Two-Stage Workflow Addition

**Problem**: Users often don't know what they want until they see concrete designs. Single-stage workflows force premature commitment.

**Solution**: Two-stage workflow (Stage 1 form + Stage 2 document) enables iterative refinement.

**Timeline**:
1. Original: Single-stage Prometheus (generate design document directly)
2. Intermediate: Two-stage Prometheus (form + document) without Momus
3. Current: Two-stage Prometheus + Momus (form + Gate 1 + document + Collaborative Review + Final Self-Review)

**Why Three Iterations?**: Each iteration addressed a specific failure mode:
- Single-stage: Users couldn't articulate requirements upfront
- Two-stage without Momus: No quality gate, garbage-in-garbage-out
- Two-stage with Momus: Quality gate + continuous feedback

## Appendix: Future Considerations

### Audit Agent Nesting Depth

**Current**: Flat audit hierarchy (6 dimension agents + 2 meta-auditors).

**Future**: Nested audit hierarchy (dimension agents spawn sub-auditors for specific concerns).

**Tradeoff**: Nesting increases audit depth but also increases complexity and execution time.

### Workflow/Hoare Fusion

**Current**: workflow.md and Hoare logic are separate methodologies.

**Future**: Unified methodology that integrates process discipline with formal verification.

**Tradeoff**: Fusion simplifies the system but risks losing the distinct concerns each methodology addresses.

### Design Intent Detection Accuracy

**Current**: Parallel explore agents with manual assessment by Sisyphus.

**Future**: ML-based intent classification (train on historical design sessions).

**Tradeoff**: ML improves accuracy but introduces dependency on training data and model maintenance.

## Document Maintenance

**Ownership**: This document is maintained by the OMPV2 development team.

**Update Triggers**:
- Major architectural changes (new agents, new workflows, new hooks)
- Design decision reversals (tradeoffs that didn't work out)
- Methodology updates (changes to hoare-*.md or workflow.md)

**Review Cadence**: Quarterly review to ensure document remains accurate and complete.

**Version History**:
- 2026-04-26: Initial version (post-Prometheus/Momus restructuring)

