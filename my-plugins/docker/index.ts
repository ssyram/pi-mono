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
import { DOCKER_MAX_HEIGHT_PERCENT, DockerComponent } from "./component.js";
import type { DockerSection } from "./component.js";
import { DockerWidthWarningComponent } from "./width-warning.js";

interface DockerRemove {
	id: string;
}

const MIN_TERM_WIDTH = 50;
const DOCKER_UPDATE = "docker:update";
const DOCKER_REMOVE = "docker:remove";
const DOCKER_CLEAR = "docker:clear";
const DOCKER_AVAILABLE_FLAG = "$__docker_available__";

export default function dockerExtension(pi: ExtensionAPI): void {
	let handle: OverlayHandle | null = null;
	let warningHandle: OverlayHandle | null = null;
	let component: DockerComponent | null = null;
	let hidden = false;
	const disposers: Array<() => void> = [];

	// Signal presence so other plugins can detect docker synchronously
	(globalThis as Record<string, unknown>)[DOCKER_AVAILABLE_FLAG] = true;

	pi.on("session_start", (_event, ctx) => {
		setupOverlay(ctx);
		setupWidthWarningOverlay(ctx);
		setupEventBus();
	});

	function setupOverlay(ctx: ExtensionContext): void {
		// Fire-and-forget: the overlay persists until session ends
		ctx.ui.custom<void>(
			(tui, theme) => {
				component = new DockerComponent(theme, tui);
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "top-right",
					width: "30%",
					minWidth: 28,
					maxHeight: `${DOCKER_MAX_HEIGHT_PERCENT}%`,
					margin: { top: 1, right: 1 },
					nonCapturing: true,
					visible: (termWidth) => termWidth >= MIN_TERM_WIDTH,
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

	function setupWidthWarningOverlay(ctx: ExtensionContext): void {
		ctx.ui.custom<void>(
			(tui, theme) => new DockerWidthWarningComponent(theme, tui, MIN_TERM_WIDTH),
			{
				overlay: true,
				overlayOptions: {
					anchor: "top-right",
					width: 30,
					minWidth: 20,
					maxHeight: 1,
					margin: { top: 1, right: 1 },
					nonCapturing: true,
					visible: (termWidth) => termWidth < MIN_TERM_WIDTH,
				},
				onHandle: (h) => {
					warningHandle = h;
					warningHandle.setHidden(true);
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
			if (!handle && !warningHandle) return;
			hidden = !hidden;
			handle?.setHidden(hidden);
			warningHandle?.setHidden(hidden);
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
		warningHandle = null;
		component = null;
		hidden = false;
	});
}
