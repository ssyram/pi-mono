# Rebuild principles

## Scope

The plugin may change only runtime terminal drawing. AI/provider/tool/input/session behavior and idle native Pi behavior remain unchanged.

## Facts established by the removed design

- Pi renders the full component tree into `previousLines` and compares that full logical line array on every render.
- The plugin cannot read the terminal's current text frame; a cursor-position response does not supply it.
- `TUI.render()` is not a documented pure, re-entrant observation API during a patched `doRender()` transaction.
- A plugin cannot truthfully manufacture Pi's private renderer baseline from independently written terminal bytes.

## Non-negotiable invariants

1. A stable physical row is never cleared or moved unless new output occupies that row.
2. Exactly one renderer owns every physical row at a time.
3. No renderer handoff depends on an uncontracted second component observation.
4. Unknown state preserves the current visible owner; it must not trigger a speculative native recovery.
5. The plugin must not intercept or transform AI-visible events or user input.

## Architectural boundary

A Codex-style renderer separates immutable transcript state, a mutable active cell, and a bounded viewport buffer. Pi currently owns a full-tree `previousLines` model. A plugin-only implementation cannot both bypass Pi's full render and later fabricate a seamless native handoff.

Before new renderer code is written, choose one product contract:

- **Managed-only active run:** own a bounded active viewport until a separately specified settled transition.
- **Native runtime history commit:** requires an official Pi render/adoption transaction API; it is not implementable safely through private fields.

No implementation is accepted until the settled-transition contract is specified and tested against a real Pi terminal.
