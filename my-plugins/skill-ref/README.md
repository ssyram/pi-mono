# skill-ref

A [pi](https://github.com/badlogic/pi-mono) extension for referring to skills and prompts **in the middle of a sentence**.

Two halves of one idea:

1. **Mid-sentence `/` + Tab completes skills and prompts** instead of listing filesystem paths.
2. **`try_load_skill_or_prompt`** turns such a reference into the resource's own text, so the model can actually act on it.

The second half exists because pi only expands a slash command when it is the *first* thing in a message. A `/qpdi` written mid-sentence is plain text; this tool is how it gets cashed in.

## Behaviour

### Completion

| Input | Behaviour |
|---|---|
| `/` at the start of a line, then Tab | pi's native command menu — **untouched** |
| `/qp` mid-sentence, then Tab | menu of matching skills and prompts |
| `/` mid-sentence, then Tab | all skills and prompts |
| `/zzzz` mid-sentence, then Tab | nothing — deliberately no fallback to path completion |
| `@`, command arguments, other extensions | delegated unchanged |

Selecting a candidate inserts `/name ` at the cursor. Menu entries are tagged and coloured by kind (skill / prompt) using the active theme.

Matching is loose: `abc` means `.*a.*b.*c.*`, and `.` / `*` are wildcards rather than literals, so `x...a` and `x..a` both mean `.*x.*a.*`.

### Tool

```
try_load_skill_or_prompt({ query, limit? })
```

`query` accepts every equivalent spelling — `"/workflow"`, `"workflow"`, `"skill:workflow"` and `"SKILL:workflow"` all resolve to the same resource (the kind prefix is case-insensitive; the name is not):

- **one exact hit, same case** → one line, `/skill:qpdi loaded successfully from <path>`, then the file's full text
- **anything else that matches the name ignoring case** → every such identifier, listed; nothing is loaded on a guess
- **no name match** → loosely matching candidates as `skill:NAME` / `prompt:NAME`
- **nothing at all** → the full list of available identifiers

Only a unique, same-case match loads outright. pi can hold `Abc` and `abc` at the same time, so folding case during matching would make the qualified identifier useless for telling them apart — and the qualified identifier is exactly what an ambiguous answer tells you to call back with. Every identifier the tool offers is guaranteed to load uniquely on the next call.

In the TUI, a collapsed result is deliberately one line: success reports the loaded identifier, source path, and original content length in characters; failure reports only the candidate count. Expanding the result shows the original tool content. This rendering does not alter what the model receives, and the global impression configuration passes this tool through without distillation.

Identifiers are always `skill:NAME` or `prompt:NAME`; there is no path-based form. pi dedupes skills by name and prompts by name at load time, so that pair is already globally unique. Candidate listings omit file paths on purpose: loading through this tool keeps the whole resource-loading channel identifiable by tool name, which lets other extensions treat it specially rather than seeing generic file reads.

## Install

```bash
pi install <path-to-this-directory>
# or add to .pi/extension-repos.json
```

## Where the resources come from

Whatever pi itself considers a skill or a prompt — `pi.getCommands()` is the only source. That covers `~/.pi/agent/skills`, `<project>/.pi/skills`, the prompt equivalents, and anything contributed by packages or other extensions, and it follows `/reload` with no cache to invalidate.

## Tests

The repo root has no vitest install, so the unit tests run on `node:test` via tsx:

```bash
node --import tsx --test my-plugins/skill-ref/src/*.test.ts
```

## Design docs

- `docs/design/principles.md` — what this is for, and the source-level assumptions it rests on
- `docs/design/research.md` — the survey behind it, plus the decisions that were escalated
- `docs/design/architecture.md` — module contracts, correctness argument, accepted trade-offs, test plan
