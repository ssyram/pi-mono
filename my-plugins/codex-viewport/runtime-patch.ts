import type { Component, TUI } from "@earendil-works/pi-tui";
import type { CompletionTracker } from "./completion-tracker.js";
import { tuiInternals, type TuiInternals } from "./tui-internals.js";
import { createComponentBridge, type ComponentBridge } from "./viewport-bridge.js";

interface RuntimePatchResult {
	deferredAlignment: boolean;
}

interface RuntimePatch {
	dispose(): RuntimePatchResult;
}

interface MarkedTui extends TuiInternals {
	__codexViewportRuntimePatch?: RuntimePatch;
}

class InstalledRuntimePatch implements RuntimePatch {
	private tui: MarkedTui;
	private bridge: ComponentBridge;
	private originalDoRender: () => void;
	private patchedDoRender: () => void;
	private onFailure: (error: unknown) => void;
	private enabled = true;

	constructor(tui: MarkedTui, bridge: ComponentBridge, onFailure: (error: unknown) => void) {
		this.tui = tui;
		this.bridge = bridge;
		this.onFailure = onFailure;
		this.originalDoRender = tui.doRender;
		this.patchedDoRender = () => this.render();
		tui.doRender = this.patchedDoRender;
		tui.__codexViewportRuntimePatch = this;
	}

	dispose(): RuntimePatchResult {
		if (!this.enabled) return { deferredAlignment: false };
		this.enabled = false;
		try {
			this.bridge.restore();
		} catch {}
		this.restoreMethod();
		return { deferredAlignment: false };
	}

	private render(): void {
		if (!this.enabled) {
			this.originalDoRender.call(this.tui);
			return;
		}
		try {
			this.bridge.reconcile();
		} catch (error) {
			this.failOpen(error);
		}
		this.originalDoRender.call(this.tui);
	}

	private failOpen(error: unknown): void {
		if (!this.enabled) return;
		this.enabled = false;
		try {
			this.bridge.restore();
		} catch {}
		this.restoreMethod();
		try {
			this.onFailure(error);
		} catch {}
	}

	private restoreMethod(): void {
		if (this.tui.doRender === this.patchedDoRender) Reflect.deleteProperty(this.tui, "doRender");
		if (this.tui.__codexViewportRuntimePatch === this) {
			Reflect.deleteProperty(this.tui, "__codexViewportRuntimePatch");
		}
	}
}

function installRuntimePatch(
	tui: TUI,
	tracker: CompletionTracker<Component>,
	getToolsExpanded: () => boolean,
	onFailure: (error: unknown) => void,
	onRejected: (reason: string) => void = () => {},
): RuntimePatch | undefined {
	const internals = tuiInternals(tui) as MarkedTui;
	if (!Object.isExtensible(internals)) {
		onRejected("TUI instance is not extensible");
		return undefined;
	}
	if (internals.__codexViewportRuntimePatch) {
		onRejected("another codex-viewport runtime already owns this TUI");
		return undefined;
	}
	if (Object.hasOwn(internals, "doRender")) {
		onRejected("another extension already owns this TUI renderer");
		return undefined;
	}
	const bridge = createComponentBridge(tui, tracker, getToolsExpanded);
	if (!bridge) {
		onRejected("the Pi component tree does not match the supported layout");
		return undefined;
	}
	return new InstalledRuntimePatch(internals, bridge, onFailure);
}

export { installRuntimePatch };
export type { RuntimePatch, RuntimePatchResult };
