# Runtime Path Audit

## Purpose

Audit current `my-plugins/steering-flow` code for runtime path problems, with special focus on how paths inside Markdown, YAML, and other flow configuration files are resolved.

## Scope

Primary code paths:

- Flow loading path resolution.
- Markdown/YAML/JSON flow file parsing.
- Condition `cmd` and `args` resolution.
- Builtin condition lowering.
- Tape path passing.
- Visualizer path handling.
- Storage/session path handling.
- Stop-hook/runtime restore path semantics.

## Baseline Policy

This is an audit pass. Do not change code unless a confirmed issue requires immediate patching and the user authorizes or the fix is clearly non-decisional.

## Audit Questions

1. When a flow file is Markdown/YAML/JSON, what is the base directory for relative paths inside the file?
2. Are condition `cmd` paths resolved relative to the flow file, the current working directory, or the process working directory?
3. Are condition `args` paths resolved consistently with `cmd` paths?
4. Do builtins preserve the same path semantics?
5. Does runtime restore preserve the flow directory if the session cwd changes?
6. Are visualizer input/output paths contained and predictable?
7. Are there path traversal or symlink escape risks already known or newly visible?

## Entries

### 2026-05-17 Entry 1 — Audit started

Input material:

- User request for comprehensive code audit with path focus.
- Existing constitution and audit trace context.

Operation:

- Created this audit record.

Output:

- `my-plugins/steering-flow/docs/constitution/runtime-path-audit.md`

Next step:

- Read path-related implementation files and existing path documentation.

### 2026-05-17 Entry 2 — Runtime path semantics established

Input material:

- `index.ts`
- `engine.ts`
- `storage.ts`
- `parser.ts`
- `builtin-registry.ts`
- `steering-flow-command.ts`
- `visualizer/create-artifact.ts`
- `visualizer-cli.ts`
- `docs/configuration-tutorial.md`
- `docs/builtin-procedures.md`

Operation:

- Traced flow-file loading, condition execution, builtin expansion, storage restore, and visualizer path handling.

Output:

- Flow file path on load is resolved against the current pi session `cwd`.
- Once loaded, the flow config file directory is persisted as `flow_dir`.
- In condition `cmd` and config-authored `args`, tokens starting with `./` or `../` resolve against persisted `flow_dir`.
- Bare `cmd` values use normal `PATH` lookup.
- Absolute `cmd` and `args` are passed unchanged.
- Raw LLM/user action arguments are not resolved relative to `flow_dir`.
- Builtin helper script paths are plugin-module-relative; builtin user args then flow through the ordinary condition arg resolution path.
- Visualizer input/output paths are rooted in `cwd`, not `flow_dir`, and use realpath containment.
- Storage is rooted in current session `cwd`; stored `flow_dir` preserves condition-resource resolution across runtime operations, but migrated FSMs without `flow_dir` fall back to the FSM storage dir.

Next step:

- Check examples and docs for violations of these path semantics.

### 2026-05-17 Entry 3 — Confirmed path/runtime issues found

Input material:

- Example flow configs under `my-plugins/steering-flow/examples`.
- Builtin helper scripts.
- Current path semantics from Entry 2.

Operation:

- Grepped example configs for `cmd`, `args`, `builtin`, `./`, `../`, and script references.
- Verified file existence for resolved script paths.
- Inspected builtin helper argument contracts.

Output:

Confirmed issues:

1. `examples/ultra-work.yaml` uses `./examples/scripts/...` inside a flow file already located in `examples/`. Under current runtime semantics this resolves to `examples/examples/scripts/...`, which does not exist. The intended paths appear to be `./scripts/...`.
2. `examples/auto-proof.yaml` references `./scripts/require-key-lte.mjs`, but `examples/scripts/require-key-lte.mjs` does not exist.
3. `examples/submit-self-check.yaml` uses `builtin: submit/required-fields` with `args: [DESIGN_DOC, SELF_CHECK_OK, REVIEW_OK]`, but `builtins/submit-required-fields.mjs` expects the tape path as the final argument. It will treat `REVIEW_OK` as a file path and fail to read tape.

Potential documentation issue:

- `needs_tape` appears only in older docs/audit traces, not in current source code. Current source uses explicit `${$TAPE_FILE}` in condition args.

Next step:

- Continue broader read-only code audit and decide whether these should be fixed in this pass or reported for user decision.

### 2026-05-17 Entry 4 — Independent audits confirmed findings

Input material:

- Runtime path audit record.
- Path-related source files.
- Example flows with suspected issues.
- Builtin helper scripts and current docs.

Operation:

- Ran read-only functional, cross-boundary, and spec/implementation subagent audits with explicit `yunwu/gpt-5.5`.

Output:

Confirmed by auditors:

- Flow files load relative to current session `cwd`.
- Inside a loaded flow, condition `cmd` and config-authored `args` starting with `./` or `../` resolve relative to persisted `flow_dir`, the directory of the flow config file.
- Subprocess `cwd` remains session `cwd`, not `flow_dir`.
- Raw action arguments are not flow-dir-resolved.
- Builtin helper paths are plugin/module-relative; builtin user args then follow ordinary condition arg handling.
- Current source has no active `needs_tape`; old docs mentioning it are stale.
- The three checked runtime issues are real:
  - `ultra-work.yaml` broken `./examples/scripts/...` paths.
  - `auto-proof.yaml` missing `require-key-lte.mjs` helper.
  - `submit-self-check.yaml` missing `${$TAPE_FILE}` for `submit/required-fields`.

Additional audit findings:

- `storage.ts` restores `flow_dir` without type validation, so malformed `fsm.json` can propagate a non-string `flow_dir` into path resolution instead of surfacing clean corruption.
- `condition.args` accepts path-like strings without parser-level ambiguity rejection. Only `./` and `../` get flow-dir resolution; `scripts/foo.mjs` remains cwd-relative for child interpretation.
- Post-interpolation `cmd` can bypass parser-side path-shape validation; e.g. a placeholder can produce `scripts/check.mjs` after validation.
- Flow load containment uses lexical `resolve`/`relative`, while visualizer containment uses `realpath`; symlinks inside `cwd` can target outside files for load.
- `examples/submit-self-check.yaml` appears to claim a soft-review demonstration but uses `always-true.mjs` in the inspected state.

Next step:

- Report confirmed issues immediately and ask whether to patch example/doc/code issues, or proceed with non-decisional fixes if authorized.
