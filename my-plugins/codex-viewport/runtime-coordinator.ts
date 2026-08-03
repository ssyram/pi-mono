import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { CompletionTracker } from "./completion-tracker.js";
import { installRuntimePatch, type RuntimePatch } from "./runtime-patch.js";
import { getTui } from "./tui-probe.js";

const RUNTIME_PHASES = ["idle-native", "active-managed", "active-native-fallback", "disposed"] as const;
type RuntimePhase = (typeof RUNTIME_PHASES)[number];

function failureText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

class RuntimeCoordinator {
	readonly tracker = new CompletionTracker<Component>();
	private phase: RuntimePhase = "idle-native";
	private tui?: TUI;
	private patch?: RuntimePatch;
	private getToolsExpanded?: () => boolean;
	private notifyFallback?: (reason: string) => void;

	capture(ctx: ExtensionContext): void {
		try {
			this.disposePatch();
			this.tracker.reset();
			this.tui = undefined;
			this.getToolsExpanded = undefined;
			this.notifyFallback = ctx.hasUI
				? (reason) => ctx.ui.notify(`codex-viewport disabled for this run: ${reason}`, "warning")
				: undefined;
			if (!ctx.hasUI) {
				this.phase = "idle-native";
				return;
			}
			this.tui = getTui(ctx);
			this.getToolsExpanded = () => ctx.ui.getToolsExpanded();
			this.phase = ctx.isIdle() ? "idle-native" : "active-native-fallback";
		} catch {
			this.phase = ctx.isIdle() ? "idle-native" : "active-native-fallback";
		}
	}

	startRun(): void {
		try {
			this.tracker.reset();
			if (this.phase !== "idle-native" || !this.tui || !this.getToolsExpanded) {
				this.enterFallback("runtime prerequisites are unavailable or the run was already active at load time");
				return;
			}
			let rejectionReported = false;
			this.patch = installRuntimePatch(
				this.tui,
				this.tracker,
				this.getToolsExpanded,
				(error) => this.enterFallback(`component reconciliation failed: ${failureText(error)}`),
				(reason) => {
					rejectionReported = true;
					this.enterFallback(reason);
				},
			);
			if (this.patch) this.phase = "active-managed";
			else if (!rejectionReported) this.enterFallback("runtime patch installation failed");
		} catch (error) {
			this.disposePatch();
			this.enterFallback(`runtime patch installation threw: ${failureText(error)}`);
		}
	}

	finishRun(): void {
		try {
			const deferredAlignment = this.disposePatch();
			this.tracker.reset();
			this.phase = "idle-native";
			if (deferredAlignment) this.tui?.requestRender(true);
		} catch {
			this.tracker.reset();
			this.phase = "idle-native";
		}
	}

	shutdown(): void {
		try {
			this.disposePatch();
		} catch {}
		this.tracker.reset();
		this.tui = undefined;
		this.getToolsExpanded = undefined;
		this.notifyFallback = undefined;
		this.phase = "disposed";
	}

	isManaged(): boolean {
		return this.phase === "active-managed";
	}

	private enterFallback(reason: string): void {
		this.phase = "active-native-fallback";
		try {
			this.notifyFallback?.(reason);
		} catch {}
	}

	private disposePatch(): boolean {
		const patch = this.patch;
		this.patch = undefined;
		return patch?.dispose().deferredAlignment ?? false;
	}
}

export { RuntimeCoordinator };
export type { RuntimePhase };
