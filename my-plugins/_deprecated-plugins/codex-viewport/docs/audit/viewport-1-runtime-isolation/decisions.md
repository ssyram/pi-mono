# viewport-1-runtime-isolation Decisions

## Superseding stability decision

Observed physical transcript duplication and repeated process exits during user input invalidate the previous custom active renderer approval.

The plugin now treats Pi's native renderer as the sole terminal owner. It may wrap `doRender` only to reconcile component ownership before calling the original method exactly once. It does not patch render scheduling or terminal lifecycle, write ANSI output, or modify cursor/viewport baselines.

Native redraw is an accepted safety degradation. Process stability, input/IME correctness, and single-copy transcript behavior have higher priority than an absolute `2J/3J=0` requirement.

The prior geometry repaint and deferred-alignment decision remains only as historical context and is no longer implemented.
