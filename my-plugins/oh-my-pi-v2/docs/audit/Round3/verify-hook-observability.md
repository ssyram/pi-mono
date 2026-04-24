# Round 3 hook/UI observability verification

Scope: verified Round 3 R3-C4/R3-C6/R3-C7/R3-C8/R3-C9/R3-C10 against current source. Read only the permitted Round 3 audit docs (`round-context.md`, `candidates.md`, `reduction.md`) and inspected the requested source files plus the hook files cited by Round 3.

## Summary

| Candidate | Result | Finding |
|---|---:|---|
| R3-C4 | PASS | Shutdown widget cleanup is contained and logs synchronous cleanup failure. |
| R3-C6 | PASS | `keyword-detector` local hook failure catch logs before fallback; other `undefined` returns are no-op paths. |
| R3-C7 | PASS | `tool-output-truncator` truncation catch logs before fallback; under-limit return is no-op. |
| R3-C8 | PASS | `rules-injector` discovery/parsing/injection catch paths log before fallback; no-op returns are justified. |
| R3-C9 | PASS | `sisyphus-prompt` discovery and prompt injection failures log before fallback; sub-agent return is no-op. |
| R3-C10 | FAIL | Most `comment-checker` catch paths now log, but one unexpected checker execution error path still returns `null` without a local diagnostic. |

## R3-C4 — shutdown widget cleanup containment

**Result: PASS**

Source evidence:

- `my-plugins/oh-my-pi-v2/index.ts:209-215` wraps the shutdown cleanup in `try/catch`:
  - `ctx.ui.setWidget("omp-tasks", undefined)` at line 211.
  - Catch logs `console.error(`[oh-my-pi task] Widget shutdown cleanup failed: ...`)` at lines 212-213.
  - `latestCtx = undefined` still runs after the contained cleanup at line 215.
- Related normal widget path is also contained:
  - `index.ts:59-120` wraps task widget updates in `try/catch`.
  - `setWidget` calls occur at lines 63, 78, and 118.
  - Catch logs `[oh-my-pi task] Widget update failed: ...` at lines 119-120.

Conclusion: shutdown widget cleanup is contained and observable.

## R3-C6 — `keyword-detector.ts` hook observability

**Result: PASS**

Source evidence:

- `my-plugins/oh-my-pi-v2/hooks/keyword-detector.ts:140-154` contains justified no-op fallbacks:
  - no prompt returns `undefined` at line 141.
  - no detected keywords returns `undefined` at line 145.
  - filtered/no effective keywords returns `undefined` at line 154.
- `keyword-detector.ts:158-160` catches local hook failures, logs `console.error("[oh-my-pi keyword] Keyword detector failed: ...")`, then returns `undefined`.

Conclusion: failure fallback is observable; non-error fallbacks are justified no-op paths.

## R3-C7 — `tool-output-truncator.ts` hook observability

**Result: PASS**

Source evidence:

- `my-plugins/oh-my-pi-v2/hooks/tool-output-truncator.ts:29` returns `undefined` when output is already under the truncation limit; this is a justified no-op path.
- `tool-output-truncator.ts:54-56` catches truncation failures, logs `console.error("[oh-my-pi truncator] Failed to truncate tool output: ...")`, then returns `undefined`.

Conclusion: failure fallback is observable; under-limit fallback is a justified non-error path.

## R3-C8 — `rules-injector.ts` hook observability

**Result: PASS**

Source evidence:

- `my-plugins/oh-my-pi-v2/hooks/rules-injector.ts:83-87` catches invalid glob matching failures, logs `[oh-my-pi rules] Invalid glob pattern ...`, then returns `false`.
- `rules-injector.ts:120-135` treats missing frontmatter as a non-error default at lines 123-124; frontmatter parse failures log `[oh-my-pi rules] Failed to parse rule frontmatter: ...` at lines 133-134 and return default metadata/raw body at line 135.
- `rules-injector.ts:259-266` logs rule file read failures (`[oh-my-pi rules] Failed to read rule file ...`) and rule directory scan failures (`[oh-my-pi rules] Failed to scan rule directory ...`) before returning `[]`.
- `rules-injector.ts:328-387` has justified hook no-op returns at lines 329, 347, and 365; the injection catch logs `[oh-my-pi rules] Rules injection failed: ...` at lines 385-386 and returns `undefined` at line 387.

Conclusion: local discovery/parsing/injection catch paths are observable; remaining fallbacks are no-op/default paths.

## R3-C9 — `sisyphus-prompt.ts` hook observability

**Result: PASS**

Source evidence:

- `my-plugins/oh-my-pi-v2/hooks/sisyphus-prompt.ts:42-65` catches per-agent file read and directory discovery failures:
  - file read failures log `[oh-my-pi sisyphus] Failed to read agent file ...` at lines 58-59.
  - directory discovery failures log `[oh-my-pi sisyphus] Failed to discover agents in ...` at lines 62-63.
  - discovery still returns a sorted list at line 65.
- `sisyphus-prompt.ts:673-679` logs async discovery failure with `[oh-my-pi sisyphus] Agent discovery failed: ...`.
- `sisyphus-prompt.ts:681-700` has a justified sub-agent no-op return at line 688; prompt injection failures log `[oh-my-pi sisyphus] Prompt injection failed: ...` at lines 697-698 and return `undefined` at line 699.

Conclusion: agent discovery and prompt injection failure paths are observable; sub-agent no-op return is justified.

## R3-C10 — `comment-checker.ts` hook observability

**Result: FAIL**

Passing evidence found:

- `my-plugins/oh-my-pi-v2/hooks/comment-checker.ts:120-147` catches PATH lookup failure, logs `[oh-my-pi comments] comment-checker not found in PATH: ...` at lines 130-131, and returns `null` only after no binary candidates exist at lines 146-147.
- `comment-checker.ts:150-163` catches npm package resolution failure, logs `[oh-my-pi comments] Failed to resolve comment-checker npm package: ...` at lines 160-161, and returns `[]` at line 163.
- `comment-checker.ts:318-327` logs temp-file cleanup failure (`[oh-my-pi comments] Failed to remove temp file ...`) and logs outer AST check failure (`[oh-my-pi comments] AST comment check failed: ...`) before returning `null`.
- `comment-checker.ts:449-487` contains justified hook no-op returns at lines 450-457, 465, and 477; outer hook failure logs `[oh-my-pi comments] Comment checker hook failed: ...` at lines 485-486 and returns `undefined` at line 487.
- `comment-checker.ts:459-477` falls back to regex detection when AST checking returns `null`, so this path does not abort the hook.

Remaining failure:

- `comment-checker.ts:286-301` wraps the checker `execSync` call. The catch accepts status `2` stderr as parser/checker output at lines 295-299, but the unexpected timeout/crash/other-error path returns `null` at lines 300-301 without a local `console.error` or UI diagnostic.

Conclusion: R3-C10 is not fully fixed. Most catch paths are observable, but the unexpected checker execution branch is still silent and is not a justified non-error path.

## Additional requested source checks

- `my-plugins/oh-my-pi-v2/commands/utils.ts:29-37`: `readAgentPrompt()` logs `[oh-my-pi commands] Failed to read agent prompt ...` before returning `undefined` on read failure.
- `my-plugins/oh-my-pi-v2/commands/start-work.ts:39-45`: `loadState()` logs `[omp-start] Failed to load state: ...` before returning `null`.
- `commands/start-work.ts:49-59`: `saveState()` documents best-effort persistence and logs `[omp-start] Failed to save state: ...` on failure.
- `commands/start-work.ts:221-234` and `303-312`: plan save/persist failures notify the UI with `Failed to save plan: ...` warnings.
- `commands/start-work.ts:315-320`: `session.dispose()` runs in `finally`; outer command failures notify the UI with `omp-start error: ...`.
