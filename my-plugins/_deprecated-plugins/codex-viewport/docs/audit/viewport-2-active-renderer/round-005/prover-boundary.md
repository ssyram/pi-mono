# Round 005 Cross-Boundary Proof: codex-viewport Active Renderer

## Review

- **Correct:** The current Pi checkout has the private renderer fields and methods modeled by `TuiInternals`; the nine-child interactive root order matches `probePiLayout`; Pi input listeners support consume/replacement results; the baseline origin equation is consistent with Pi's logical cursor and viewport fields; and native handoff compares normalized visible rows and cursor coordinates before seeding Pi state.
- **Blocker:** DSR interception is not isolated from previously registered Pi input listeners. An earlier listener can consume or transform the cursor-position report before `queryTerminalCursor` sees it, and replay after timeout can invoke earlier listeners twice.
- **Blocker:** Managed lines are not restricted to non-positioning ANSI. A component can return cursor movement, scroll-region, origin-mode, OSC, or unrecognized image controls that pass `normalizeLines`, invalidating the frame model.
- **Blocker:** `diffInlineViewport` permits changed area top/height but never clears rows present only in the previous area. Its correctness is proven only for equal areas, while the caller can supply rebased frames.
- **Blocker:** Entry commitment relies on repeated `Component.render(width)` calls being deterministic. Pi's component interface does not state or enforce purity, and the entry algorithm can permanently classify stale physical rows as committed.
- **Note:** `detectSupportedTerminal` is an environment-name allowlist, not a capability or TTY proof. In particular, accepted `vt100` does not establish synchronized-output support.
- **Note:** `Terminal.write` is synchronous in type but has no delivery or atomicity acknowledgment. State commitment after a non-throwing return proves only that Pi accepted/enqueued the string.
- **Note:** The requested `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` does not exist. `progress.md` contains only `Status: In Progress` with empty task/file sections. Per instruction, no existing `docs/audit` material was read or used as evidence.

## Verdict Legend

- **PROVEN:** Follows from the current plugin and official Pi source under stated PRE/RELY conditions.
- **PARTIAL:** True only under an unstated or unenforced boundary condition, or the runtime guard proves less than the TypeScript interface claims.
- **DISPROVEN:** A concrete admitted execution violates the assumption.

## Exact Official-Source Verification

| Official source | Verified fact | Boundary consequence |
|---|---|---|
| `packages/tui/src/tui.ts:295-317` | `TUI` currently owns `previousLines`, `previousKittyImageIds`, `previousWidth`, `previousHeight`, `cursorRow`, `hardwareCursorRow`, `showHardwareCursor`, `maxLinesRendered`, `previousViewportTop`, and `stopped`; the renderer state is private. | `tui-internals.ts` matches this checkout, but relies on an unsupported private ABI. |
| `packages/tui/src/tui.ts:256-290` | `Container` exposes `children`, `removeChild`, `render`, and `invalidate`; rendering concatenates child renders. | The chat-container shape is correct for current Pi. |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts:453-474,701-714` | Interactive Pi adds exactly: header, loaded resources, chat, pending messages, status, above-editor widgets, editor, below-editor widgets, footer. | `pi-layout.ts:15-28` decodes the current tree correctly. |
| `packages/coding-agent/src/core/extensions/types.ts:167-173` | A widget factory receives `(tui: TUI, theme)` and returns a component. | The acquisition mechanism in `tui-probe.ts` uses an official callback shape, but the public type does not promise synchronous callback execution. |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2082-2097,2118-2140` | Extension terminal input delegates to `TUI.addInputListener`; `setWidget` delegates to the interactive widget implementation. | `queryTerminalCursor` participates in the shared listener set; it has no priority or exclusivity. |
| `packages/tui/src/tui.ts:90-91,649-657,763-836` | Listeners run in `Set` insertion order over the current string. `consume` returns immediately; `data` replaces the string; remaining input reaches the focused component. | An earlier listener can prevent the query listener from seeing DSR, and replay through `handleInput` re-enters earlier listeners. |
| `packages/tui/src/tui.ts:1236-1254` | Cursor extraction scans the bottom `height` lines, removes the marker, and computes `col` with `visibleWidth`. | `render-pi-lines.ts` matches Pi's cursor-marker interpretation, but must bound the resulting column itself. |
| `packages/tui/src/tui.ts:1256-1326` | Native rendering reads terminal dimensions, renders, extracts cursor, applies line resets, writes synchronized full output, then commits frame, viewport, cursor, Kitty IDs, width, and height. | Entry must observe a completed render. A thrown or partially delivered write cannot be inferred from state alone. |
| `packages/tui/src/tui.ts:1337-1367` | First render, width/height changes, and shrink conditions can force full render. | `previous*` semantics differ across full and diff paths but are intentionally normalized after completion. |
| `packages/tui/src/tui.ts:1369-1452` | Native diff detection uses exact normalized string equality. Unchanged and deletion paths retain/update viewport fields differently. | Exact row equality in plugin handoff is aligned with current Pi, not a semantic ANSI comparison. |
| `packages/tui/src/tui.ts:1455-1621` | Pi emits erase-line and cursor movement inside synchronized-output guards, writes, then sets `cursorRow`, `hardwareCursorRow`, `previousViewportTop`, and `previousLines`. | `cursorRow` is logical content end; `hardwareCursorRow` is the logical row occupied by the physical cursor. |
| `packages/tui/src/tui.ts:1629-1659` | Hardware positioning is relative to `hardwareCursorRow`, uses absolute column, then updates `hardwareCursorRow` and cursor visibility. | `DSR.row - (hardwareCursorRow - previousViewportTop)` is the correct current-source origin equation when state and terminal are coherent. |
| `packages/tui/src/terminal.ts:52-72,454-470` | `Terminal.write(data): void`; dimensions are numeric getters. `ProcessTerminal.write` calls `process.stdout.write`; columns/rows may fall back to environment values or `80x24`. | No write acknowledgment exists, and dimensions are not necessarily live terminal geometry. |
| `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:83` | Assistant messages expose `updateContent`. | The current assistant predicate recognizes the intended class but is not nominal. |
| `packages/coding-agent/src/modes/interactive/components/tool-execution.ts:23,164,201` | Tool execution has runtime `toolCallId`, `updateResult`, and `setExpanded`. | Current tool/expandable shapes match, but unrelated objects can collide structurally. |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts:156-163` | Pi itself treats callable `setExpanded` structurally. | `isExpandableComponent` is aligned with current Pi practice. |

## Assumption Table

| ID | File/boundary | Assumption | Proof or challenge | Status |
|---|---|---|---|---|
| A1 | `tui-internals.ts:8-31,38-51`, plugin -> private TUI | A passing guard is safe to use as `TuiInternals`. | Current Pi has the named members. The guard checks only `typeof`, arrays, and `instanceof Set`; it does not prove signatures, finite/integer numeric values, element types, terminal shape, or semantic relationships. | **PARTIAL** |
| A2 | `tui-probe.ts:4-14`, extension UI -> TUI | `setWidget` invokes the factory synchronously, before immediate removal and function return. | The official overload supplies `TUI`, but the public contract does not state synchronous invocation. `result` otherwise remains `undefined`. The key can also collide with another extension using the same string. | **PARTIAL** |
| A3 | `pi-layout.ts:15-28`, plugin -> Pi component tree | The root has exactly nine children in the assumed order. | Exact match in current `interactive-mode.ts:701-714`; chat at index 2 is a current `Container`. Any Pi layout change fails closed because count/container checks reject it. | **PROVEN** for this checkout |
| A4 | `component-shapes.ts:16-40`, plugin -> Pi components | Property presence uniquely identifies assistant/tool/expandable components. | Intended current classes have those properties, and Pi also uses a structural expandable check. No nominal discriminator or signature check prevents an extension component with the same property names from being misclassified. | **PARTIAL** |
| A5 | `render-pi-lines.ts:11-36`, component -> renderer | Repeated `render(width)` yields the same logical lines until invalidation/state change. | Neither `Component` nor `Container.render` enforces purity. Baseline and commitment code rerender the same objects multiple times. | **DISPROVEN** |
| A6 | `render-pi-lines.ts:15-24`, component ANSI -> terminal | Image rejection, Pi line resets, and `visibleWidth <= width` make a line safe for absolute-row painting. | These checks do not reject cursor movement, scroll margins, origin mode, erasure, arbitrary OSC/DCS, or Sixel. Such controls alter terminal state outside the modeled row. | **DISPROVEN** |
| A7 | `render-pi-lines.ts:26-36`, Pi cursor marker -> viewport cursor | Extracted cursor coordinates are valid for the viewport. | Row is bounded by extraction depth, but column is not checked against `width`. A marker after exactly `width` cells produces `column === width` while the line still passes `visibleWidth(line) > width`. | **PARTIAL** |
| A8 | `cursor-position-report.ts:11-22`, terminal -> plugin | A standard CPR `CSI row;column R` is parsed losslessly and converted to zero-based safe integers. | The implementation removes the first matching report and preserves surrounding bytes. Positive safe coordinates are correctly converted. It intentionally does not accept private/intermediate variants. | **PROVEN** for the admitted grammar |
| A9 | `query-terminal-cursor.ts:8-82`, plugin DSR -> Pi input | The query owns the DSR response and preserves all unrelated input exactly once. | Registration precedes the write and partial suffix buffering is coherent. However earlier listeners run first and may consume/transform CPR; timeout replay through private `handleInput` invokes those earlier listeners again. | **DISPROVEN** |
| A10 | `query-terminal-cursor.ts:34-73`, timeout/abort -> user input | Retaining the late filter for 1 second prevents a late CPR from reaching the editor without side effects. | It usually protects the focused component, but temporarily delays partial prefixes, can consume a user-supplied CPR-shaped sequence, and duplicates observation by earlier listeners on replay. Abort uses different immediate replay behavior. | **PARTIAL** |
| A11 | `detect-supported-terminal.ts:3-8`, environment -> terminal capabilities | Accepted environment names imply DSR, CUP, EL, ANSI parsing, synchronized output, reliable dimensions, and an interactive TTY. | No `isTTY` or capability query is performed. `TERM=vt100` is accepted although synchronized output `?2026` is not a VT100 capability; `TERM=xterm` may be inherited under redirection; tmux presence proves neither downstream terminal nor passthrough behavior. | **DISPROVEN** |
| A12 | `kitty-image-block.ts:1-3`, rendered ANSI -> image-free rows | Checking Kitty APC and iTerm `1337;File=` detects all terminal image output relevant to row painting. | Sixel (`DCS ... q`) and other DCS/OSC graphics are admitted. Cursor-affecting Kitty/iTerm variants split or encoded outside these literal substrings are not proven absent. | **DISPROVEN** as a general image guard |
| A13 | `native-entry-baseline.ts:31-39`, Pi state + DSR -> terminal origin | `originRow = reportedRow - (hardwareCursorRow - previousViewportTop)` locates logical line zero. | This is algebraically consistent with current Pi cursor movement and viewport tracking. It requires state from a completed Pi render, no intervening cursor movement, and truthful DSR coordinates. | **PROVEN under PRE/RELY** |
| A14 | `native-entry-baseline.ts:40-83`, Pi frame -> stable/committed prefix | First mismatch and per-child cumulative lengths identify already committed chat components. | Multiple root/child renders are not captured atomically. A stateful component can return the old row during prefix comparison and the new row during child snapshotting, causing stale physical history to be declared committed. | **DISPROVEN** |
| A15 | `native-entry-baseline.ts:58-75`, `previousLines` -> physical rows | `previousViewportTop + physicalRow - originRow` reconstructs the visible native screen. | Correct when the Pi state is coherent, dimensions are live, and no unmodeled terminal control moved/rewrote rows after Pi's render. Out-of-range logical rows are blanked deliberately. | **PROVEN under PRE/RELY** |
| A16 | `native-handoff.ts:18-43`, managed frame -> Pi native baseline | Equal normalized visible rows and equal cursor coordinates suffice for a seamless handoff. | Row/cursor equality is strong and aligned with Pi's exact diff. Cursor visibility is not compared, terminal modes/margins are not attested, and admitted ANSI can make strings unequal to physical cells. | **PARTIAL** |
| A17 | `native-handoff.ts:46-53`, plugin -> Pi renderer state | Assigned fields form a valid Pi diff-render baseline. | `previousLines`, dimensions, bottom viewport, logical content end, logical cursor row, max line count, and empty Kitty IDs are coherent if A16's physical-state premise holds. Private invariants remain version-sensitive. | **PROVEN under A16 and current Pi ABI** |
| A18 | `screen-frame-diff.ts:7-16`, logical frames -> terminal | Comparing rows at absolute coordinates and repainting changed next rows transforms any previous frame into next. | Only width equality is required. Rows belonging to the previous area but outside the next area are never erased or restored. | **DISPROVEN** |
| A19 | `screen-frame-diff.ts:3-25`, emitted ANSI -> cells | `CUP`, `EL 2`, then row bytes updates exactly one absolute row. | True only with origin mode off, normal coordinate semantics, no hostile positioning controls in row text, valid dimensions, and a terminal supporting CUP/EL. These are not established by detection. | **PARTIAL** |
| A20 | `terminal-render-plan.ts:7-10`, output -> terminal transaction | `?2026h ... ?2026l` makes history/frame/cursor update atomic. | Concatenation and balanced guards are syntactically correct for a successful whole write. Accepted terminals need not support synchronized output; partial delivery or write failure can leave the mode enabled. | **DISPROVEN** as a portability/atomicity claim |
| A21 | `managed-renderer.ts:110-124`, `Terminal.write` -> committed plugin state | A non-throwing write means it is safe to accept ledger/frame state. | The implementation commits after the call, matching Pi's ordering. The official `void` API provides no drain, delivery, terminal-application, or atomicity acknowledgment. | **PARTIAL** |

## PRE / POST / RELY / GUARANTEE

### 1. TUI Acquisition and ABI Probe

**PRE**

- The session is interactive and `ExtensionContext.ui.setWidget` supports component factories.
- No unrelated extension owns `codex-viewport:tui-probe`.
- The active object is the same `TUI` that owns the interactive component tree and `ProcessTerminal`.

**RELY**

- Widget factory invocation is synchronous for this Pi implementation.
- Private fields retain the meanings verified in `packages/tui/src/tui.ts`.
- No concurrent tree mutation occurs between probe and runtime-patch installation.

**GUARANTEE**

- If `tuiInternals` and `probePiLayout` succeed, all named members and the current nine positional roles exist.
- The guarantee is structural only; it does not establish method signatures, numeric invariants, or future ABI compatibility.

**Verdict:** **PARTIAL**.

### 2. Cursor Query and Input Multiplexing

**PRE**

- The terminal accepts `CSI 6 n` and returns `CSI row;column R` on the same input stream.
- All previously registered listeners pass the report through unchanged.
- The report arrives before timeout, or late-filter behavior is acceptable.

**RELY**

- Pi preserves listener insertion order and replacement/consume semantics (`tui.ts:763-836`).
- Input chunks remain strings and the query listener remains registered until cleanup.
- Direct replay through `TuiInternals.handleInput` is safe and reentrancy-free.

**POST**

- On timely success, the first admitted report is removed and its zero-based position is returned; parser-reported surrounding bytes continue downstream.
- On abort, the query unregisters and replays its buffered suffix.
- On timeout/write error, the query rejects while retaining interception for up to 1 second.

**GUARANTEE CHALLENGE**

- The implementation cannot guarantee exclusive DSR ownership or exactly-once observation across all listeners. An earlier listener can consume CPR, and replay re-enters earlier listeners.

**Verdict:** **DISPROVEN** as an end-to-end input-preservation contract.

### 3. Native Entry Baseline

**PRE**

- `previousWidth/previousHeight` equal the dimensions used for the last completed native render.
- `previousLines` is the normalized frame committed by that render.
- `previousViewportTop` and `hardwareCursorRow` are coherent logical coordinates.
- DSR reflects the physical cursor after that render and before any other terminal writer acts.
- Rendered components are deterministic during capture and contain only modeled ANSI.

**RELY**

- Terminal dimensions do not change during capture.
- Component state and tree identity do not change between root and per-child renders.
- No overlay or other extension writes to the terminal.

**POST**

- `area.top` is the physical row corresponding to logical line zero.
- `initialFrame.rows` reconstructs the managed physical area from `previousLines`.
- `initialStableRows` is exposed only when enough stable prefix is attested.
- `baselineCommittedComponents` is a consecutive chat prefix ending by `stableEnd`.

**GUARANTEE CHALLENGE**

- The origin and row mapping are proven under PRE/RELY.
- Stable commitment is not proven because render determinism/atomicity is absent from the component contract.

**Verdict:** origin/frame mapping **PROVEN under conditions**; commitment **DISPROVEN**.

### 4. Managed Full/Diff Paint

**PRE**

- Frame areas are valid terminal coordinates.
- For diff painting, previous and next areas are identical, or all vacated previous rows are separately restored/cleared.
- Each row is free of cursor-positioning, erasure, scrolling, mode-setting, and unmodeled image controls.
- Cursor row and column are integers inside the frame width and height.
- Terminal is in normal origin mode with compatible CUP/EL semantics.

**RELY**

- `terminal.columns/rows` remain stable through planning and write.
- No concurrent terminal writer interleaves bytes.
- Synchronized update is either supported or safely ignored.
- `Terminal.write` accepts the complete string as one ordered output chunk.

**POST**

- `paintInlineViewport` writes every next row.
- `diffInlineViewport` writes every changed next row for equal areas.
- `buildTerminalRenderPlan` orders history, frame, then cursor inside balanced synchronized-update sequences.
- Managed ledger/frame state is committed only after `write` returns without throwing.

**GUARANTEE CHALLENGE**

- PRE is not enforced for same-area diffing, ANSI safety, cursor column, terminal mode, capabilities, or acknowledged output.

**Verdict:** byte construction **PROVEN**; physical-frame transformation **PARTIAL/DISPROVEN** for admitted inputs.

### 5. Native Handoff

**PRE**

- `state.stableRows + frame.rows + trailing blanks` is an accurate cell-level model of the physical screen.
- The native render result is deterministic enough to compare and is free of terminal images/unmodeled ANSI.
- Cursor position and visibility are known.
- Dimensions and terminal mode remain unchanged.

**RELY**

- No output occurs between comparison/state seeding and restoration/native rendering.
- Current Pi preserves the verified meanings of all seeded private fields.
- A subsequent native diff uses exact normalized row equality.

**POST**

- On rejection, no private renderer fields are changed.
- On success, Pi's logical previous frame, dimensions, viewport, logical content end, logical hardware cursor row, max line count, and Kitty ID set are seeded consistently with the compared native frame.
- A later native diff can compare against that frame without a mandatory full redraw.

**GUARANTEE CHALLENGE**

- `frame.showHardwareCursor` is not compared with `tui.showHardwareCursor` or explicitly applied.
- Terminal modes and physical cell equivalence are not attested by string equality.

**Verdict:** private-state seed **PROVEN under PRE/RELY**; seamless physical handoff **PARTIAL**.

## State Trace

| Phase | `previousLines` | `previousViewportTop` | Cursor fields | Native full/diff | Plugin physical frame |
|---|---|---|---|---|---|
| Completed Pi full render | Normalized complete logical frame committed after `terminal.write` (`tui.ts:1285-1326`). | Derived by the full-render path from output/viewport geometry. | `cursorRow` tracks logical content end; `hardwareCursorRow` tracks the logical row of the physical cursor; visibility follows `showHardwareCursor`. | Full synchronized buffer has already been submitted. | Not active. |
| Completed Pi diff | Exact new normalized frame committed after diff write (`tui.ts:1603-1621`). | `max(prevViewportTop, finalCursorRow - height + 1)` on the main diff path; unchanged/deletion paths differ as verified at `tui.ts:1369-1452`. | `cursorRow = max(0,newLines.length-1)`; `hardwareCursorRow = finalCursorRow`, then positioning may update it. | Changed rows use native relative movement/erase logic. | Not active. |
| Entry DSR | Unchanged. | Unchanged. | DSR physical row plus `hardwareCursorRow - previousViewportTop` yields `originRow`. DSR column is preserved. | Native renderer is gated/patched. | `initialFrame` reconstructs rows from the logical frame and viewport. |
| Managed rendering | Pi fields remain the native baseline because patched `doRender` owns output. | Remains native baseline. | Pi cursor fields are stale by design; managed `frame.cursor` models current physical cursor. | Native full/diff is not invoked. | Full/diff absolute paints update managed `stableRows`, `area`, and `frame` only after non-throwing write. |
| Handoff preparation | Set to freshly rendered native logical lines. | Set to `max(0,nativeLines.length-height)`. | `cursorRow = nativeLines.length-1`; `hardwareCursorRow = extracted native cursor row`; cursor column is compared but not stored because Pi re-extracts it from lines. | No native output is required only if physical visible rows/cursor already equal the seeded native frame. | Expected to equal the bottom native viewport. |
| First restored native render | Compared against seeded `previousLines`; exact string diff determines output. | Updated by native path. | Native positioning restores row/column/visibility according to current Pi state. | Full render occurs if Pi's force/dimension conditions demand it; otherwise diff. | Ownership ends. |
| Write failure | Pi native code and plugin both generally avoid committing state after a synchronous throw. | Old value remains until recovery. | Old logical state remains; physical terminal may be partially changed because the API has no atomic-delivery guarantee. | Recovery attempts native redraw/reset, but delivery is again unacknowledged. | Cannot be proven from state alone. |

`previousKittyImageIds` follows the same transaction boundary: Pi gathers and commits it after native output; seamless handoff sets it to an empty set only after the plugin's limited image scan rejects recognized Kitty/iTerm markers. Because the scan is not a complete graphics/control proof, empty IDs do not prove an image-free physical terminal.

## Concrete Reachable Counterexamples

1. **Earlier listener consumes DSR.** Extension A registers `onTerminalInput(data => data.includes("\x1b[") ? {consume:true} : undefined)` before codex-viewport. Pi iterates listeners in insertion order. The terminal replies `\x1b[12;8R`; Extension A consumes it, so `queryTerminalCursor` times out. This violates exclusive DSR capture without malformed terminal behavior.

2. **Earlier listener observes buffered input twice.** Extension A records every input and passes it through. The query listener receives a trailing partial `\x1b[` and consumes/buffers it. On timeout it unregisters and calls private `handleInput("\x1b[")`; Extension A records the same bytes again. Focused input may still be once, but cross-listener exactly-once delivery is false.

3. **Cursor-moving component line escapes its row.** A reachable extension/custom component returns `["\x1b[1Atext"]`. It contains neither recognized image marker; `visibleWidth` is small; `applyLineResets` does not sanitize positioning controls. `paintInlineViewport` first moves to row N, then component bytes move to row N-1. The recorded `frame.rows[N]` no longer describes the physical update.

4. **Sixel bypasses image detection.** A component returns a Sixel DCS such as `ESC P q ... ESC \\`. `containsTerminalImage` checks only Kitty `ESC_G` and iTerm `OSC 1337;File=`. The raster/cursor effects are accepted as an ordinary row.

5. **Vacated area row survives diff.** Previous frame: area `[top=1,bottom=4]`, rows `A,B,C`. Next frame with the same width: area `[top=2,bottom=4]`, rows `B,C`. Every next row compares equal at its absolute coordinate, so `diffInlineViewport` emits `""`; physical row 1 still contains `A` although it is outside the next frame. `InlineViewportFrame` permits both frames, and managed height rebasing can supply differing areas.

6. **Full-width cursor is out of bounds but admitted.** A rendered line has exactly `width` visible cells followed by Pi's cursor marker. Extraction returns `column === width`; after marker removal, `visibleWidth(line) === width`, so normalization passes. `createInlineViewportFrame` rejects only negative columns. Subsequent absolute positioning requests one column beyond the modeled viewport and relies on terminal-specific clamping/wrap behavior.

7. **Stateful render corrupts baseline commitment.** A chat component's first capture render returns `old`, matching `previousLines`; its later per-child and snapshot renders return stable `new`. `stableEnd` includes the component, `baselineCommittedComponents` includes it by line count, and later determinism checks see `new === new`. Physical stable history remains `old`, but the ledger now treats `new` as already committed and need not repaint it. `Component.render` permits this behavior.

8. **Accepted terminal lacks synchronized updates.** `TERM=vt100` passes `detectSupportedTerminal`, but DEC synchronized output mode `CSI ? 2026 h/l` is not established by that identifier. The byte wrapper exists, but atomic visual update is not guaranteed.

9. **Fallback dimensions are not physical geometry.** With `TERM=xterm-256color`, missing `stdout.columns/rows`, and no valid `COLUMNS/LINES`, `ProcessTerminal` reports `80x24` even if the downstream terminal is `132x40`. Pi and plugin agree with each other on fallback values, so the baseline dimension equality check passes; rows outside the assumed 24-row surface are not modeled.

10. **Cursor visibility changes without handoff rejection.** A managed frame was painted with `frame.showHardwareCursor=true`; Pi state later changes `tui.showHardwareCursor=false` without changing row strings or cursor coordinates. `prepareNativeHandoff` compares neither visibility flag nor current physical visibility, seeds state, and can report seamless. Immediate post-handoff cursor visibility is not proven until another native positioning operation occurs.

11. **Structural component collision.** A custom chat component unrelated to assistant messages exposes an `updateContent` method for its own API. `isAssistantComponent` returns true solely from that method name. The ledger can apply assistant lifecycle assumptions to the wrong component without any Pi ABI violation.

12. **Non-acknowledged output diverges from state.** `process.stdout.write` may return `false` for backpressure, but `ProcessTerminal.write` discards the result and returns `void`. Managed rendering commits its ledger/frame after that return. The bytes are ordered into Node's stream, but application to the terminal before later lifecycle operations is not established.

## Optimization

1. **Capture once, do not rerender for proof.** Build a single immutable render snapshot per component/root during entry and derive `stableEnd`, cumulative child boundaries, and committed snapshots from that capture. This removes both the determinism hole and repeated render cost.

2. **Make the diff contract explicit.** Either require identical `top`, `bottom`, `height`, `width`, and `terminalHeight` before `diffInlineViewport`, falling back to full paint otherwise, or emit erases/restoration for `previous - next` absolute rows. The equality guard is cheaper and safer.

3. **Whitelist row-safe ANSI.** Tokenize ANSI once and admit only styling/SGR plus Pi's already-extracted cursor marker. Reject CUP/CUU/CUD, erase, scroll margins, origin/alternate-screen modes, OSC/DCS/APC, and all graphics protocols. This consolidates image and cursor-control checks into one boundary validator.

4. **Bound all coordinates.** Require finite integers and enforce `0 <= cursor.column < area.width`, valid `previousViewportTop`, valid logical cursor rows, and positive finite dimensions at the ABI boundary. This turns later arithmetic checks into simple trusted invariants.

5. **Use an input multiplexer with priority/ownership.** Pi needs a first-class request/response terminal protocol API or priority listener that captures CPR before general extension listeners while preserving each byte exactly once. Replaying through private `handleInput` should be replaced with continuation from the query listener's position, not restart of the listener chain.

6. **Separate capability from identity.** Require interactive TTY status and explicit required capabilities. Treat synchronized output as optional optimization: use it only when positively detected, while preserving correctness without it. Do not accept fallback dimensions as an attested physical geometry without a separate terminal-size source.

7. **Compare complete handoff state.** Include cursor visibility and relevant terminal modes in handoff equality. If they cannot be attested, emit an explicit cursor/mode normalization sequence or force one native redraw.

8. **Version the private ABI.** Replace the permissive structural cast with an exact current-version adapter that validates own/prototype locations, finite values, collection contents, and method behavior where safely probeable. Fail closed on Pi version/layout drift.

9. **Minimize private state mutation.** Prefer an official Pi renderer handoff/snapshot API. Until one exists, keep the existing compare-before-assign transaction, but force native full render whenever any state dimension cannot be proven rather than attempting a synthetic diff baseline.

## Final Classification

- **PROVEN:** Current nine-child layout; current private-field existence; current Container shape; admitted CPR parsing; baseline origin algebra; visible-row mapping under coherent native state; handoff field assignments under exact physical equivalence; byte ordering of full/diff plans.
- **PARTIAL:** Runtime ABI guard; synchronous TUI probe; structural component identity; cursor bounds; timeout replay; native handoff completeness; terminal writes; dimensions; physical meaning of ANSI row strings.
- **DISPROVEN:** DSR isolation/exactly-once behavior; capability inference; comprehensive image/ANSI safety; render determinism; arbitrary-area frame diff correctness; synchronized-output atomicity; visibility-complete seamless handoff.

No tests were run: this was a review-only source proof, and the requested artifact is the only file written.
