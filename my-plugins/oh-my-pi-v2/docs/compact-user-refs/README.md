# Temporary references for compaction

**Status:** Active after explicit user approval, with both extra estimate gates removed. The updated 49-test suite, scoped types and changed-file formatting pass. The user's live compact self-test produced expanded source text, an unknown-reference diagnostic and a restored literal. A subsequent bounded independent Hoare crash-path review found no reachable new syntax/projection exception under valid native inputs and sufficient resources; empty-result fallback and expansion memory growth remain documented limits. No additional limits or fallback policies were introduced.

Owner: oh-my-pi-v2. This focused feature retains its existing docs/compact-user-refs directory, despite expanding sources beyond user messages.

The approved source universe is the previous summary BODY and actual pure-text user messages in the current filtered messagesToSummarize. Sources remain at existing prompt positions. Prior summary chunks use complete lines and a 33× label-length threshold; each current user message is one whole block. Assistant/tool/custom messages, terminal file lists, task context, and instructions are visible as before but unindexed.

The facade selects references by source presence only. It retains the original model generation maxTokens but performs no input-fit or expanded-output estimate/rejection. A nonblank expanded body is returned intact, then the existing file suffix is appended once.

All indices are invocation-local. Expand references before saving the next summary. No selection details, historical lookup, matching, duplicate catalog, or extra LLM message exists in this design.

- [Approval](APPROVED-SCOPE.md): parent-recorded user decisions, authoritative over old documents.
- [Principles](principles.md): Q.I/Q.A/Q.E and root properties.
- [Architecture](architecture.md): exact algorithms, grammar, contracts and limitations.
- [Infrastructure](infrastructure-plan.md): concrete files, APIs, tests and line estimates.
- [Integration](integration-plan.md): applied one-file wiring with no extra estimates and live self-test outcome.
- [Verification](verification.md): offline and live evidence, crash-path reasoning boundaries and reproduction commands.

Historical drafts, full review transcripts and local execution logs are not part of the distributable feature.
