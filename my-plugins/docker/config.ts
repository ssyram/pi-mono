import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { OverlayOptions, OverlayMargin, SizeValue } from "@mariozechner/pi-tui";
import {
	CONFIG_FILE_NAME,
	DEFAULT_MIN_CONTENT_LINES,
	DEFAULT_MIN_TERM_WIDTH,
	DEFAULT_OVERLAY,
	DEFAULT_START_HIDDEN,
	DEFAULT_WARNING_OVERLAY,
} from "./types.js";
import type { DockerConfig, DockerOverlayConfig, ResolvedDockerConfig, ResolvedDockerOverlayConfig } from "./types.js";

function parseJsonConfig(path: string): DockerConfig | null {
	try {
		if (!existsSync(path)) return null;
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return parsed as DockerConfig;
		}
	} catch {
		// Ignore invalid or unreadable config.
	}
	return null;
}

export function loadConfig(cwd: string): DockerConfig {
	const globalConfig = parseJsonConfig(join(getAgentDir(), CONFIG_FILE_NAME));
	const localConfig = parseJsonConfig(join(cwd, ".pi", CONFIG_FILE_NAME));
	return {
		...globalConfig,
		...localConfig,
		overlay: {
			...globalConfig?.overlay,
			...localConfig?.overlay,
		},
		warningOverlay: {
			...globalConfig?.warningOverlay,
			...localConfig?.warningOverlay,
		},
	};
}

function normalizeMargin(margin: OverlayMargin | number | undefined): OverlayMargin | number {
	if (margin === undefined) return DEFAULT_OVERLAY.margin;
	if (typeof margin === "number") return Math.max(0, margin);
	return {
		top: margin.top === undefined ? undefined : Math.max(0, margin.top),
		right: margin.right === undefined ? undefined : Math.max(0, margin.right),
		bottom: margin.bottom === undefined ? undefined : Math.max(0, margin.bottom),
		left: margin.left === undefined ? undefined : Math.max(0, margin.left),
	};
}

function normalizeSizeValue(value: SizeValue | undefined, fallback: SizeValue): SizeValue {
	if (typeof value === "number") return value;
	if (typeof value === "string" && /^\d+(?:\.\d+)?%$/.test(value)) return value;
	return fallback;
}

function resolveOverlayConfig(raw: DockerOverlayConfig | undefined, fallback: ResolvedDockerOverlayConfig): ResolvedDockerOverlayConfig {
	return {
		width: normalizeSizeValue(raw?.width, fallback.width),
		minWidth: raw?.minWidth ?? fallback.minWidth,
		maxHeight: normalizeSizeValue(raw?.maxHeight, fallback.maxHeight),
		anchor: raw?.anchor ?? fallback.anchor,
		offsetX: raw?.offsetX ?? fallback.offsetX,
		offsetY: raw?.offsetY ?? fallback.offsetY,
		row: raw?.row,
		col: raw?.col,
		margin: normalizeMargin(raw?.margin ?? fallback.margin),
		nonCapturing: raw?.nonCapturing ?? fallback.nonCapturing,
		priority: raw?.priority ?? fallback.priority,
	};
}

export function resolveConfig(raw: DockerConfig): ResolvedDockerConfig {
	return {
		minTermWidth: raw.minTermWidth ?? DEFAULT_MIN_TERM_WIDTH,
		minContentLines: raw.minContentLines ?? DEFAULT_MIN_CONTENT_LINES,
		startHidden: raw.startHidden ?? DEFAULT_START_HIDDEN,
		overlay: resolveOverlayConfig(raw.overlay, DEFAULT_OVERLAY),
		warningOverlay: resolveOverlayConfig(raw.warningOverlay, DEFAULT_WARNING_OVERLAY),
	};
}

export function toOverlayOptions(config: ResolvedDockerOverlayConfig, visible: OverlayOptions["visible"]): OverlayOptions {
	return {
		anchor: config.anchor,
		width: config.width,
		minWidth: config.minWidth,
		maxHeight: config.maxHeight,
		offsetX: config.offsetX,
		offsetY: config.offsetY,
		row: config.row,
		col: config.col,
		margin: config.margin,
		nonCapturing: config.nonCapturing,
		visible,
	};
}
