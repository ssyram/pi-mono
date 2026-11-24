# Round 005 final counter-challenge: F07/F08

## Review

- Correct: the active deployment contract is a Pi extension in a local interactive CLI/TUI. It explicitly places component render bytes across a boundary and retains local-user correctness and crash safety while excluding only hostile multi-tenant execution (`docs/audit/viewport-2-active-renderer/round-005/plan.md:22-25`). That exclusion does not promise an interference-free filesystem, trusted render bytes, or crash-free publication.
- Correct: current user-facing guarantees say snapshots succeed after artifacts are durable, use `0700` directories and `0600` files, and publish `latest.json`; they only exclude direct third-party `process.stdout` writers (`README.md:47-59`). No guarantee grants exclusive ownership of `.pi/tui-snapshots`, forbids same-user path manipulation, restricts component rows to a safe control grammar, or attests terminal capabilities.
- Note: the requested repository-root `plan.md` does not exist. This review used the active Round 005 plan at `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md`. The repository-root `progress.md` contains no substantive task or contract information.

## F07 — CONFIRMED

Path and mode mitigation does not reject the finding. The external boundary is extension context data (`ctx.cwd` and `ctx.sessionManager.getSessionId()`) entering the Node filesystem writer (`codex-viewport.ts:23-24,38`). `secureWrite` performs pathname-based final-path `writeFile`/`chmod`; artifact files are published concurrently with `Promise.all`, followed by a direct final-path write of `latest.json` (`snapshot-artifacts.ts:9-12,57-58`). There is no exclusive descriptor open, symlink rejection, temp-file rename publication, file sync, or parent-directory sync.

The non-hostile-multi-tenant qualification is insufficient: stale paths, prior interrupted runs, manual diagnostic-directory changes, same-account processes, and crashes remain within local-user correctness/crash safety. The documented “durable” success guarantee strengthens rather than defeats the finding.

Minimal obligation to dispute F07:

1. A same-account filesystem test pre-creates both an artifact pathname and `latest.json` as symlinks; publication must reject without modifying either target.
2. Fault injection at every artifact/publication step must prove `latest.json` never references an incomplete bundle and observers see only the complete old or complete new pointer.
3. Syscall-level proof must show artifact files are synchronized before publication and the containing directory is synchronized after atomic rename.

## F08 — CONFIRMED, narrowed

The Kitty/iTerm image subclaim is **REJECTED**: rows containing Kitty `ESC_G` or iTerm2 `OSC 1337;File=` markers are rejected before managed rendering (`kitty-image-block.ts:1-3`; `render-pi-lines.ts:15-18`). That does not reject the surviving general-control or capability claims.

The exact content boundary is `Component.render(width): string[]` (`packages/tui/src/tui.ts:64-70`) into `normalizeLines`; normalization calls `applyLineResets` but has no accepted-control grammar (`render-pi-lines.ts:12-22`; `packages/tui/src/tui.ts:1097-1102`). Upstream `normalizeTerminalOutput` preserves recognized escape sequences rather than sanitizing them (`packages/tui/src/utils.ts:284-305`). Managed frame bytes then reach `Terminal.write(data): void` (`managed-renderer.ts:110-115,159-167`; `packages/tui/src/terminal.ts:68`), whose concrete external sink is `process.stdout.write(data)` (`packages/tui/src/terminal.ts:454-455`).

The terminal gate is only an environment-name allowlist (`detect-supported-terminal.ts:3-8`). The `Terminal` contract provides no stdout-TTY, synchronized-update, CUP, EL, general ANSI-grammar, or Sixel capability guarantee. The README restriction on independent direct stdout writers does not constrain control-bearing bytes returned by official, third-party, or future `Component.render()` implementations.

Minimal obligation to dispute F08:

1. Define an explicit accepted row-control grammar and test that CSI cursor/mode controls, arbitrary OSC/DCS/APC/PM/SOS, and Sixel are either modeled safely or rejected before any managed write.
2. Add a confinement/property test proving every accepted row preserves the renderer’s modeled cursor, row, and synchronized-update state.
3. Prove the actual output is a TTY and attest required synchronized-update/CUP/EL capabilities at preflight; negative tests must show unsupported output/capabilities cause native fallback with no managed `terminal.write`.

Neither a deployment-context contract nor a trusted-input contract currently rejects F07 or the surviving portion of F08. No item is merely DISPUTED on the available guarantees.