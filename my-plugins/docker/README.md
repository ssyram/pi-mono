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

Other plugins communicate via the shared `pi.events` EventBus. Import channel constants from the protocol module, or use the string literals directly.

### Channels

| Channel | Payload | Action |
|---|---|---|
| `"docker:update"` | `DockerSection` | Upsert a section |
| `"docker:remove"` | `{ id: string }` | Remove a section |
| `"docker:clear"` | `undefined` | Remove all sections |

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

If your plugin should work with or without docker:

```ts
function publishStatus(pi: ExtensionAPI, ctx: ExtensionContext, info: string): void {
  // Always try docker
  pi.events.emit("docker:update", {
    id: "my-section",
    title: "My Section",
    order: 20,
    lines: info.split("\n"),
  });

  // Optionally also keep a short footer summary
  ctx.ui.setStatus("my-key", info.split("\n")[0]);
}
```

No need to check if docker is loaded — EventBus emits are fire-and-forget. If docker isn't installed, the events are silently ignored.

## Behavior

- **Starts hidden** — press `Ctrl+Shift+T` to show
- **Non-capturing** — doesn't steal keyboard focus; editor stays active
- **Auto-hides** on terminals narrower than 100 columns
- **Overlay** — renders on top of main content (not a true split pane)
- **Anchored** right-center, 25% width (min 28 columns), 80% max height

## Files

```
my-plugins/docker/
├── index.ts        — Extension entry: overlay, shortcuts, EventBus wiring
├── component.ts    — DockerComponent: sections, scroll, box rendering
├── protocol.ts     — Types and channel constants
└── README.md       — This file
```
