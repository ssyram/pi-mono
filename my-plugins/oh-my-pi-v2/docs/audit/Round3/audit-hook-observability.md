# Round 3 audit — hook observability coverage

## Finding 1 — Keyword detector hook silently disables injection on local callback failure

Hoare triple:
- Pre: `registerKeywordDetector` receives a `before_agent_start` event and local code inside the callback throws while reading the system prompt, detecting keyword matches, building the Ultrawork message, filtering detections, or constructing the returned prompt override.
- Command: `my-plugins/oh-my-pi-v2/hooks/keyword-detector.ts:128-160` catches all errors with `catch { return undefined; }`.
- Post: The host sees a normal no-op hook result, keyword/Ultrawork injection is skipped, and there is no `console.error`, `console.warn`, UI warning, or diagnostic return to distinguish the failure from an intentional no-op.

Why this violates Round 3: Contract 6 requires local hook failures to remain observable where feasible. This is a local catch path, not a known async host API limitation.

## Finding 2 — Tool-output truncator silently leaves oversized output untruncated on local callback failure

Hoare triple:
- Pre: A `tool_result` event reaches `registerToolOutputTruncator`, and local truncation logic throws while iterating `event.content`, reading text lengths, mapping blocks, or constructing the override.
- Command: `my-plugins/oh-my-pi-v2/hooks/tool-output-truncator.ts:18-57` catches all errors with `catch { return undefined; }`.
- Post: The hook returns a normal no-op result, the original tool output remains untruncated, and no log/UI warning records that the protective truncation fallback failed.

Why this violates Round 3: This swallows a local protective-hook failure silently and can break the intended fallback path that prevents oversized tool results from entering context.

## Finding 3 — Rules injector silently drops rules and prompt injection on local parse/scan/callback failures

Hoare triple:
- Pre: Rule discovery or injection encounters a local failure: invalid glob handling throws, YAML/frontmatter parsing throws, a rule file read/parse/hash/push fails, a configured rule directory is unreadable, or the `before_agent_start` callback throws while scanning/filtering/formatting/appending rules.
- Command: `my-plugins/oh-my-pi-v2/hooks/rules-injector.ts:77-88`, `120-135`, `253-265`, and `324-386` catch those failures and return `false`, raw metadata, `[]`, skip a file, or `undefined` without diagnostics.
- Post: Applicable rules can be treated as non-matching, malformed rules can be injected with empty metadata, directories/files can disappear from consideration, or all rule injection can be skipped, with no observable local failure signal.

Why this violates Round 3: These are local rule-processing failures with feasible logging. The catch paths make failure indistinguishable from valid “no matching rules” behavior.

## Finding 4 — Sisyphus prompt hook silently loses agent discovery or prompt supplementation failures

Hoare triple:
- Pre: Agent discovery fails for the agents directory or an individual `.md` file, or the `before_agent_start` callback throws/rejects while awaiting discovery, checking the current prompt, building supplements, or appending prompt text.
- Command: `my-plugins/oh-my-pi-v2/hooks/sisyphus-prompt.ts:40-66` and `672-695` catch those failures and continue with an empty/partial agent list or `return undefined` without diagnostics.
- Post: The generated Sisyphus prompt can omit available agents/categories/code-enforcement supplements, or the hook can skip prompt injection entirely, with no log/UI warning distinguishing failure from intentional no-op.

Why this violates Round 3: The failures are local and observable via logging; they are not host fire-and-forget API limitations.

## Finding 5 — Comment checker silently suppresses warning generation on local callback failures

Hoare triple:
- Pre: A successful Edit/Write `tool_result` enters `registerCommentChecker`, and local warning-generation code throws while extracting written text, resolving/running the AST checker, falling back to regex matching, or constructing the appended warning result.
- Command: `my-plugins/oh-my-pi-v2/hooks/comment-checker.ts:461-506` catches all callback failures with `catch { return undefined; }`. Additional local AST-path failures in `checkWithAST` return `null` without diagnostics at `315-322` and `345-347`.
- Post: The hook returns a normal no-op result, lazy-comment warnings can be skipped, and unexpected AST/checker failures are indistinguishable from “no lazy comments found.”

Why this violates Round 3: The outer catch silently suppresses a local hook failure. Although the expected AST `status === 2` detection path is handled and `null` falls through to regex fallback, unexpected local failures remain unobservable.
