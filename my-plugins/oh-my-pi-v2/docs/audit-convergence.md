# Convergence Audit -- oh-my-pi-v2

**Date**: 2026-04-15
**Scope**: Targeted verification of `stripStringLiterals` rewrite and `[AGENT:` sub-agent detection
**Methodology**: Manual execution trace of all 8 specified cases; cross-repo data flow trace for sub-agent hook firing

---

## Part A: stripStringLiterals Verification

The function (comment-checker.ts L357-426) uses three mutually recursive helpers:
- `skipString(quote)` -- advances `i` past a `"..."` or `'...'` literal, discarding content, respecting `\` escapes
- `skipTemplateLiteral()` -- advances `i` past a `` `...` `` literal, discarding template content, returning interpolation expressions
- `processInterpolation()` -- processes `${...}` interior with brace depth tracking, recursing into nested strings/templates

### Case 1: `"// rest of code"`
Main loop sees `"`, calls `skipString('"')`. Content scanned and discarded. Result: `""`. Comment text eliminated. **PASS**.

### Case 2: `'// rest of code'`
Same as Case 1 with `'`. Result: `''`. **PASS**.

### Case 3: `` `// rest of code` ``
Main loop sees `` ` ``, calls `skipTemplateLiteral()`. No `${` found; all chars skipped. Returns `""`. Result: ` `` `` `. **PASS**.

### Case 4: `` `${expr}// rest of code` ``
`skipTemplateLiteral()` encounters `${`, calls `processInterpolation()`. `processInterpolation` reads `e`,`x`,`p`,`r` into result (depth=1), hits `}` (depth=0), returns `"expr"`. Remaining template chars (`// rest of code`) are skipped. Returns `"expr"`. Result: `` `expr` ``. Interpolation KEPT, template content stripped. **PASS**.

### Case 5: `` `outer ${`inner ${x}`} end` ``
Outer `skipTemplateLiteral` -> `processInterpolation` -> nested `skipTemplateLiteral` -> nested `processInterpolation` reads `x`. Inner returns `"x"`, outer returns `"x"`. Template text at both levels discarded. Result: `` `x` ``. **PASS**.

### Case 6: `` `${`${`deep`}`}` ``
Three levels of recursion: outer template -> L1 interpolation -> middle template -> L2 interpolation -> inner template (scans `d`,`e`,`e`,`p`, discards). Each level returns `""`. No mismatched backticks; every `` ` `` paired by its own `skipTemplateLiteral` call. Result: ` `` `` `. **PASS**.

### Case 7: `` `${obj["key"]}` ``
`processInterpolation` reads `obj`, then `[` (via else branch), then sees `"` and calls `skipString('"')` which discards `key`. Then `]`, then `}` closes interpolation. Returns `"obj[]"`. Result: `` `obj[]` ``. **PASS**.

### Case 8: `"test \" // not a comment"`
`skipString('"')` scans: `t`,`e`,`s`,`t`,` `, then `\` triggers `i += 2` (skips escaped quote pair), then continues scanning ` `,`/`,`/`,... until real closing `"`. Entire content discarded as one string. No split at escaped quote. Result: `""`. **PASS**.

**All 8 cases: PASS.**

---

## Part B: Sub-Agent Detection (`[AGENT:` prefix)

### Claim to verify
v1's `call-agent.ts` and `delegate-task.ts` create in-process sessions via `createAgentSession`. omp-v2 hooks fire on these sessions. Therefore the `[AGENT:` check in `sisyphus-prompt.ts` (L684) and `keyword-detector.ts` (L134) is FUNCTIONAL, not dead code.

### Evidence chain

1. **v1 sets the prefix**: `call-agent.ts` L186: `session.agent.state.systemPrompt = \`[AGENT:${params.agent}]\n\n\` + systemPrompt`. `delegate-task.ts` L227: identical pattern.

2. **v1 creates in-process sessions**: Both tools call `createAgentSession({ cwd: ctx.cwd, model, modelRegistry, sessionManager: SessionManager.inMemory(ctx.cwd), tools })` (call-agent L178-184, delegate-task L218-224). No `resourceLoader` is provided.

3. **createAgentSession loads extensions**: `sdk.ts` L183-186: when no `resourceLoader` is passed, a `DefaultResourceLoader` is created and `reload()` is called. `reload()` scans `<cwd>/.pi/extensions/` and `~/.pi/agent/extensions/` for extensions.

4. **Extensions include omp-v2**: When omp-v2 is activated (symlinked into an extensions directory), it is discovered by the resource loader. The AgentSession constructor calls `_buildRuntime()` (L318) which creates an `ExtensionRunner` with all discovered extensions (L2320-2331).

5. **Hooks fire**: The extension runner emits `before_agent_start` events to all registered hooks, including omp-v2's `sisyphus-prompt` and `keyword-detector` hooks.

6. **The check is reached**: When omp-v2's hooks fire on the in-process sub-agent session, `ctx.getSystemPrompt()` returns the prompt set in step 1, which starts with `[AGENT:`. The check at L684 / L134 returns early, correctly preventing Sisyphus prompt injection and keyword detector activation on sub-agent sessions.

### Previous audit's claim (correctness-audit.md, section 7, point 3)
> "`[AGENT:` 前缀是 v1 遗留约定 [...] 这个检测实际上是死代码，保留仅为 v1 向后兼容。"

This claim assumed omp-v2 hooks do not run in sub-agent contexts. That assumption is incorrect for in-process sessions created by v1's tools. The hooks DO fire. The check is FUNCTIONAL.

### Code comment accuracy
The comments in sisyphus-prompt.ts L681-683 say "this hook typically doesn't run in sub-agent contexts at all". This is misleading. When v1 and v2 coexist, the hook DOES run on v1's in-process sub-agents. The `[AGENT:` guard correctly prevents unwanted prompt injection in that scenario.

**Verdict: FUNCTIONAL, not dead code.**

---

## Part C: Previous Audit Caveats Resolved

The correctness-audit.md listed two caveats (section 7, points 3 and 4):

| Caveat | Status |
|--------|--------|
| `[AGENT:` detection is dead code | **Resolved**: Functional when v1+v2 coexist (see Part B) |
| Nested template literals not handled | **Resolved**: Recursive `skipString`/`skipTemplateLiteral`/`processInterpolation` handles arbitrary nesting (see Part A, cases 5-7) |

---

## Verdict

**CONVERGED** -- zero issues found in both the `stripStringLiterals` rewrite and the sub-agent detection logic.
