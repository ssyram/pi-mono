# Docker — Universal Sidebar Panel for pi

A right-side overlay panel that other plugins can push sections into. Persistent, scrollable, toggled via keyboard shortcut.

## Quick Start

Symlink into pi extensions:

```bash
ln -s ../../my-plugins/docker .pi/extensions/docker
```

No configuration needed. Starts hidden by default.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+Shift+T` | Toggle sidebar visibility |
| `Ctrl+Shift+↑` | Scroll sidebar up |
| `Ctrl+Shift+↓` | Scroll sidebar down |

Scrolling works without stealing keyboard focus — the editor stays active.

## Protocol

Other plugins communicate via the shared `pi.events` EventBus using raw string channel names directly. Do not import helpers from docker — treat it as an optional capability.

### Channels

| Channel | Payload | Action |
|---|---|---|
| `"docker:update"` | `DockerSection` | Upsert a section |
| `"docker:remove"` | `{ id: string }` | Remove a section |
| `"docker:clear"` | `undefined` | Remove all sections |

### Capability detection without dependency

If you want to know whether docker is present **without depending on its files existing**, read this runtime flag directly from `globalThis`:

```ts
const hasDocker = (globalThis as Record<string, unknown>)["$__docker_available__"] === true;
```

- `true` → docker extension is loaded in the current runtime
- anything else → docker is not available

This keeps your plugin aware of docker **without importing it**.

### DockerSection

```ts
interface DockerSection {
  id: string;       // Unique key for this section
  title: string;    // Displayed as section header
  order: number;    // Sort priority (lower = higher on screen)
  lines: string[];  // Content lines (full replacement each time)
}
```

### Example: Publishing a Section

```ts
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI): void {
  pi.on("turn_end", (_event, ctx) => {
    pi.events.emit("docker:update", {
      id: "my-stats",
      title: "Stats",
      order: 50,
      lines: [
        `tokens: ${getTokenCount()}`,
        `cost:   $${getCost().toFixed(4)}`,
      ],
    });
  });
}
```

### Example: Conditional Routing (footer vs docker)

If your plugin should work with or without docker, check the runtime flag and choose where to publish:

```ts
function publishStatus(pi: ExtensionAPI, ctx: ExtensionContext, info: string): void {
  const hasDocker = (globalThis as Record<string, unknown>)["$__docker_available__"] === true;

  if (hasDocker) {
    pi.events.emit("docker:update", {
      id: "my-section",
      title: "My Section",
      order: 20,
      lines: info.split("\n"),
    });
    return;
  }

  ctx.ui.setStatus("my-key", info.split("\n")[0]);
}
```

You can also stay fully fire-and-forget and always emit `"docker:update"`. If docker isn't installed, the event is silently ignored.

## Behavior

- **Starts hidden** — press `Ctrl+Shift+T` to show
- **Non-capturing** — doesn't steal keyboard focus; editor stays active
- **Narrow terminals** — shows a one-line width warning on terminals narrower than 50 columns
- **Too-short terminals** — shows a warning until the terminal is resized taller
- **Overlay** — renders on top of main content (not a true split pane)
- **Anchored** top-right, 30% width (min 28 columns), 80% max height

## Files

```
my-plugins/docker/
├── index.ts           — Extension entry: overlays, shortcuts, EventBus wiring
├── component.ts       — DockerComponent: sections, scroll, box rendering
├── width-warning.ts   — One-line warning component for narrow terminals
└── README.md          — This file
```
