# S-05 Confirmation: LLM values interpolated into cmd binary path

## Verdict: CONFIRMED-solid rationale

## Evidence

The attack path is real and fully traceable through four files:

1. **types.ts**: `Condition.cmd` is typed as a plain `string` with no constraints. The comment documents `${$TAPE_FILE}` interpolation for `args` but the mechanism is generic.

2. **parser.ts**: `validateCondition()` checks that `cmd` is a non-empty string and applies a path-format check (rejects `/`-containing strings that aren't absolute or `./`/`../`-prefixed). Crucially, it performs **no check for `${...}` interpolation tokens** in `cmd`. A YAML value like `cmd: "${some-arg}"` passes validation because it contains no path separators.

3. **engine.ts lines ~33-49**: `interpolatePlaceholders()` applies a blanket `/${([^}]+)}/g` regex replacement on its input, substituting `$TAPE_FILE` with the tape path and any key found in `namedArgs`. This function is called on `rawCmd = condition.cmd` at line ~72 — meaning the binary path itself is subject to interpolation, not just `args`.

4. **engine.ts lines ~240-245 / index.ts**: `executeAction()` builds `namedArgs` by directly mapping `positionalArgs[i]` (LLM-provided strings from the `steering-flow-action` tool, passed with zero validation) to `action.arguments[i].arg_name`. These namedArgs then feed into `interpolatePlaceholders()` for the `cmd` field.

The resulting interpolated string is passed to `spawn(cmd, argv, ...)` without `shell: true`. The authors were aware of shell injection (comment: "spawned WITHOUT a shell") but did not consider that interpolation into the binary path itself allows arbitrary binary execution.

## Scope and Precondition

The vulnerability requires a YAML flow author to use `${arg-name}` syntax inside the `cmd` field of a condition or action. Static `cmd` values without interpolation tokens are not affected. However, there is no guardrail preventing this pattern — no parser warning, no allowlist of permitted binaries, and no documentation flagging it as dangerous. A flow author following the interpolation pattern documented for `args` could reasonably apply it to `cmd`, at which point the LLM fully controls which binary is executed.
