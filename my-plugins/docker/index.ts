/**
 * Docker - a universal sidebar panel for pi.
 *
 * Other plugins communicate via the shared EventBus:
 *   pi.events.emit("docker:update", { id, title, order, lines })
 *   pi.events.emit("docker:remove", { id })
 *   pi.events.emit("docker:clear")
 *
 * Keyboard shortcuts:
 *   ctrl+shift+t      - toggle sidebar visibility
 *   ctrl+shift+up     - scroll sidebar up
 *   ctrl+shift+down   - scroll sidebar down
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { OverlayHandle } from "@mariozechner/pi-tui";
import { Key } from "@mariozechner/pi-tui";
import { DockerComponent } from "./component.js";
import { DOCKER_CLEAR, DOCKER_REMOVE, DOCKER_UPDATE, markDockerAvailable } from "./protocol.js";
import type { DockerRemove, DockerSection } from "./protocol.js";

const MIN_TERM_WIDTH = 100;

export default function dockerExtension(pi: ExtensionAPI): void {
	let handle: OverlayHandle | null = null;
	let component: DockerComponent | null = null;
	let hidden = false;
	const disposers: Array<() => void> = [];

	// Signal presence so other plugins can detect docker synchronously
	markDockerAvailable();

	pi.on("session_start", (_event, ctx) => {
		setupOverlay(ctx);
		setupEventBus();
	});

	function setupOverlay(ctx: ExtensionContext): void {
		// Fire-and-forget: the overlay persists until session ends
		ctx.ui.custom<void>(
			(tui, theme) => {
				component = new DockerComponent(theme, tui);
				// Update maxLines based on terminal height
				const maxH = Math.floor(tui.terminal.rows * 0.8);
				component.setMaxLines(maxH - 3); // Account for box chrome
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "right-center",
					width: "25%",
					minWidth: 28,
					maxHeight: "80%",
					margin: { right: 1 },
					nonCapturing: true,
					visible: (w) => w >= MIN_TERM_WIDTH,
				},
				onHandle: (h) => {
					handle = h;
					// Start hidden by default
					handle.setHidden(true);
					hidden = true;
				},
			},
		);
	}

	function setupEventBus(): void {
		disposers.push(
			pi.events.on(DOCKER_UPDATE, (data) => {
				if (!component) return;
				component.updateSection(data as DockerSection);
			}),
		);
		disposers.push(
			pi.events.on(DOCKER_REMOVE, (data) => {
				if (!component) return;
				component.removeSection((data as DockerRemove).id);
			}),
		);
		disposers.push(
			pi.events.on(DOCKER_CLEAR, () => {
				if (!component) return;
				component.clear();
			}),
		);
	}

	// Toggle visibility
	pi.registerShortcut(Key.ctrlShift("t"), {
		description: "Toggle docker sidebar",
		handler: () => {
			if (!handle) return;
			hidden = !hidden;
			handle.setHidden(hidden);
		},
	});

	// Scroll sidebar up (global, doesn't steal focus)
	pi.registerShortcut(Key.ctrlShift("up"), {
		description: "Scroll docker sidebar up",
		handler: () => {
			if (!component || hidden) return;
			component.scrollUp(3);
		},
	});

	// Scroll sidebar down (global, doesn't steal focus)
	pi.registerShortcut(Key.ctrlShift("down"), {
		description: "Scroll docker sidebar down",
		handler: () => {
			if (!component || hidden) return;
			component.scrollDown(3);
		},
	});

	pi.on("session_shutdown", () => {
		for (const dispose of disposers) dispose();
		disposers.length = 0;
		handle = null;
		component = null;
		hidden = false;
	});
}
