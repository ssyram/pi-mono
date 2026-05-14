import type { OverlayAnchor, OverlayMargin, SizeValue } from "@mariozechner/pi-tui";

export const CONFIG_FILE_NAME = "docker.json";
export const DEFAULT_MIN_TERM_WIDTH = 50;
export const DEFAULT_MIN_CONTENT_LINES = 5;
export const DEFAULT_START_HIDDEN = true;
export const DEFAULT_OVERLAY_PRIORITY = 1000;

export interface DockerOverlayConfig {
	width?: SizeValue;
	minWidth?: number;
	maxHeight?: SizeValue;
	anchor?: OverlayAnchor;
	offsetX?: number;
	offsetY?: number;
	row?: SizeValue;
	col?: SizeValue;
	margin?: OverlayMargin | number;
	nonCapturing?: boolean;
	priority?: number;
}

export interface DockerConfig {
	minTermWidth?: number;
	minContentLines?: number;
	startHidden?: boolean;
	overlay?: DockerOverlayConfig;
	warningOverlay?: DockerOverlayConfig;
}

export interface ResolvedDockerOverlayConfig {
	width: SizeValue;
	minWidth: number;
	maxHeight: SizeValue;
	anchor: OverlayAnchor;
	offsetX: number;
	offsetY: number;
	row?: SizeValue;
	col?: SizeValue;
	margin: OverlayMargin | number;
	nonCapturing: boolean;
	priority: number;
}

export interface ResolvedDockerConfig {
	minTermWidth: number;
	minContentLines: number;
	startHidden: boolean;
	overlay: ResolvedDockerOverlayConfig;
	warningOverlay: ResolvedDockerOverlayConfig;
}

export const DEFAULT_OVERLAY: ResolvedDockerOverlayConfig = {
	anchor: "top-right",
	width: "30%",
	minWidth: 28,
	maxHeight: "80%",
	offsetX: 0,
	offsetY: 0,
	margin: { top: 1, right: 1 },
	nonCapturing: true,
	priority: DEFAULT_OVERLAY_PRIORITY,
};

export const DEFAULT_WARNING_OVERLAY: ResolvedDockerOverlayConfig = {
	anchor: "top-right",
	width: 30,
	minWidth: 20,
	maxHeight: 1,
	offsetX: 0,
	offsetY: 0,
	margin: { top: 1, right: 1 },
	nonCapturing: true,
	priority: DEFAULT_OVERLAY_PRIORITY,
};
