---
name: pre-publish-review
description: Three-layer review with multiple specialized agents before publishing
---

# Pre-Publish Review

Conduct a thorough pre-publish review using a three-layer agent review process.

## Layer 1: Parallel Specialized Review (10 agents)

Use `delegate_task` to spawn 10 parallel review tasks:

1. **API Surface** (ultrabrain): Review all public APIs for breaking changes, consistency, documentation
2. **Security** (ultrabrain): Scan for vulnerabilities, injection risks, auth issues, secret exposure
3. **Performance** (deep): Profile critical paths, check for N+1 queries, memory leaks, unnecessary allocations
4. **Type Safety** (ultrabrain): Verify type coverage, check for unsafe casts, ensure strict mode compliance
5. **Error Handling** (deep): Verify all error paths, check for unhandled promises, validate error messages
6. **Test Coverage** (deep): Run tests, check coverage gaps, verify edge cases
7. **Dependencies** (quick): Audit deps for vulnerabilities, check for unused packages, verify lockfile
8. **Documentation** (writing): Check README accuracy, API docs, inline comments, changelog
9. **Code Style** (quick): Lint check, formatting consistency, naming conventions
10. **Accessibility** (visual-engineering): UI components meet WCAG standards, keyboard navigation, screen reader support

## Layer 2: Cross-cutting Review (5 agents)

After Layer 1 completes, spawn 5 cross-cutting reviewers:

1. **QA Integration**: Synthesize Layer 1 findings, identify conflicts between recommendations
2. **Security Deep Dive**: Follow up on any security flags from Layer 1
3. **Code Quality**: Assess overall architecture, coupling, cohesion
4. **User Experience**: End-to-end user flow validation
5. **Release Readiness**: Version bumps, migration guides, breaking change documentation

## Layer 3: Final Verdict (Oracle)

Use `call_agent({ agent: "oracle" })` for final assessment:
- Synthesize all findings
- Output: BLOCK / RISKY / CAUTION / SAFE with justification
- List critical items that MUST be fixed before publish
- List recommended items for future improvement
