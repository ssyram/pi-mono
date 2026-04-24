# Rerun Verification: R3-C10

## Result

PASS

## Scope

Re-verified only Round 3 failed point R3-C10 after the fix. The point was that `hooks/comment-checker.ts` could return `null` from an unexpected checker execution failure without a local diagnostic, making the failure silent before the regex fallback.

## Audit Context Evidence

- `docs/audit/Round3/candidates.md` identifies R3-C10 as “comment checker hook failures are silent” and describes the claim as `comment-checker.ts` catches AST/checker and outer hook failures without diagnostics, making failures indistinguishable from no lazy comments.
- `docs/audit/Round3/reduction.md` groups R3-C10 under local hook/UI failure containment issues and expects local catch paths to add `console.error` diagnostics while preserving fallback behavior.
- `docs/audit/Round3/verify-hook-observability.md` previously marked R3-C10 as FAIL because the unexpected checker execution error path returned `null` without a local diagnostic.

## Current Source Evidence

Current `hooks/comment-checker.ts` logs before returning `null` on unexpected checker execution failures:

```ts
286      try {
287        execSync(`"${binaryPath}" < "${tmpFile}"`, {
288          encoding: "utf-8",
289          timeout: 5000,
290          stdio: ["pipe", "pipe", "pipe"],
291          maxBuffer: 1024 * 1024,
292        });
293        // exit 0 => no comments detected
294        return { detected: false, matches: [] };
295      } catch (err: unknown) {
296        const execErr = err as { status?: number; stderr?: string };
297        if (execErr.status === 2 && typeof execErr.stderr === "string") {
298          stderr = execErr.stderr;
299        } else {
300          const msg = execErr.stderr || (err instanceof Error ? err.message : String(err));
301          console.error(`[oh-my-pi comments] Comment checker execution failed: ${msg}`);
302          return null;
303        }
304      }
```

Current `hooks/comment-checker.ts` then falls back to regex when `checkWithAST()` returns `null`:

```ts
461        const binaryPath = await resolveCommentCheckerBinary();
462        if (binaryPath) {
463          const astResult = await checkWithAST(event, binaryPath);
464          if (astResult !== null) {
465            // AST detection succeeded (binary ran without unexpected error)
466            if (!astResult.detected) return undefined;
467
468            const appendedContent = [
469              ...event.content,
470              { type: "text" as const, text: buildWarningWithDetails(astResult.matches) },
471            ];
472            return { content: appendedContent };
473          }
474          // astResult === null means binary failed unexpectedly; fall through to regex
475        }
476
477        // Regex fallback
478        if (!checkForLazyCommentsRegex(written)) return undefined;
```

## Conclusion

R3-C10 is now fixed. The unexpected checker execution failure path emits `console.error("[oh-my-pi comments] Comment checker execution failed: ...")` before returning `null`, and the caller explicitly treats `null` as an unexpected binary failure before falling through to regex fallback. This satisfies the Round 3 observability requirement for the failed point.
