---
name: github-triage
description: Read-only analysis of GitHub Issues and PRs
---

# GitHub Triage

Analyze GitHub Issues and Pull Requests without making any changes.

## Usage

Provide an issue or PR URL, or a repository with filters.

## Process

1. **Gather Context**: Use `Bash` with `gh` CLI to fetch issue/PR details:
   - `gh issue view <number> --json title,body,comments,labels,assignees`
   - `gh pr view <number> --json title,body,comments,reviews,files`

2. **Analyze**: For each issue/PR:
   - Classify: bug / feature request / question / documentation / chore
   - Severity: critical / high / medium / low
   - Effort estimate: trivial / small / medium / large / epic
   - Identify affected components from file changes or description

3. **For Issues**: Suggest:
   - Reproduction steps (if bug)
   - Potential root cause (search codebase with Grep/Glob)
   - Recommended assignee based on git blame of affected files
   - Related issues (search with `gh issue list --search`)

4. **For PRs**: Analyze:
   - Code quality concerns
   - Test coverage of changes
   - Breaking change potential
   - Review checklist items

5. **Output**: Write analysis to `/tmp/github-triage-<repo>-<number>.md`

## Important

- This is READ-ONLY analysis — never push, comment, or modify issues/PRs
- Use `gh` CLI for all GitHub API interactions
- Search the codebase to validate claims about affected components
