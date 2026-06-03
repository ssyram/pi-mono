/**
 * cooldown-redraw — Pi extension that suppresses TUI full-redraw bouncing.
 *
 * NOTE: This file intentionally exceeds 200 LOC. It is a verbatim fork of a
 * single upstream function (TUI.doRender) that must remain as one unit for
 * maintainability — splitting would make the diff-against-upstream workflow
 * impractical. See MAINTENANCE WARNING below.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  MAINTENANCE WARNING — FORKED doRender()                            │
 * │                                                                         │
 * │ This file contains a FULL COPY of TUI.prototype.doRender from           │
 * │ @earendil-works/pi-tui with ONE modification (the cooldown clamp).      │
 * │                                                                         │
 * │ Synced from: @earendil-works/pi-tui v0.75.1                             │
 * │ Source file: node_modules/@earendil-works/pi-tui/dist/tui.js            │
 * │ Method:      TUI.prototype.doRender (starts ~line 733)                  │
 * │                                                                         │
 * │ HOW TO MAINTAIN:                                                        │
 * │ 1. After upgrading pi-tui, diff the original doRender against the       │
 * │    forked version below (search for "FORK START" / "FORK END").         │
 * │ 2. Apply any upstream changes to the fork EXCEPT the modified branch.   │
 * │ 3. The ONLY intentional difference is marked with "COOLDOWN PATCH".     │
 * │ 4. If the original doRender signature or internal helpers change,       │
 * │    update the fork accordingly.                                         │
 * │                                                                         │
 * │ Quick diff command:                                                     │
 * │   diff <(sed -n '/doRender()/,/^    }/p' node_modules/@earendil-works/  │
 * │     pi-tui/dist/tui.js) <(sed -n '/FORK START/,/FORK END/p'            │
 * │     my-plugins/cooldown-redraw/forked-do-render.ts)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CooldownState, CooldownConfig } from "./config-and-state.js";

// ─── Helpers (inlined from pi-tui internals, not exported) ────────────────────

function isTermuxSession(): boolean {
	return Boolean(process.env.TERMUX_VERSION);
}

function isImageLine(line: string): boolean {
	return line.includes("\x1b_G") || line.includes("\x1b]1337;");
}

// ─── Forked doRender ──────────────────────────────────────────────────────────

export function createPatchedDoRender(state: CooldownState, config: CooldownConfig) {
	// --- FORK START (synced from @earendil-works/pi-tui v0.75.1 TUI.doRender) ---
	return function patchedDoRender(this: any): void {
		if (this.stopped) return;

		const width = this.terminal.columns;
		const height = this.terminal.rows;
		const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
		const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
		const previousBufferLength =
			this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
		let prevViewportTop = heightChanged
			? Math.max(0, previousBufferLength - height)
			: this.previousViewportTop;
		let viewportTop = prevViewportTop;
		let hardwareCursorRow = this.hardwareCursorRow;

		const computeLineDiff = (targetRow: number): number => {
			const currentScreenRow = hardwareCursorRow - prevViewportTop;
			const targetScreenRow = targetRow - viewportTop;
			return targetScreenRow - currentScreenRow;
		};

		let newLines: string[] = this.render(width);

		if (this.overlayStack.length > 0) {
			newLines = this.compositeOverlays(newLines, width, height);
		}

		const cursorPos = this.extractCursorPosition(newLines, height);
		newLines = this.applyLineResets(newLines);

		const fullRender = (clear: boolean): void => {
			this.fullRedrawCount += 1;
			let buffer = "\x1b[?2026h";
			if (clear) {
				buffer += this.deleteKittyImages(this.previousKittyImageIds);
				buffer += "\x1b[2J\x1b[H\x1b[3J";
			}
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				buffer += newLines[i];
			}
			buffer += "\x1b[?2026l";
			this.terminal.write(buffer);
			this.cursorRow = Math.max(0, newLines.length - 1);
			this.hardwareCursorRow = this.cursorRow;
			if (clear) {
				this.maxLinesRendered = newLines.length;
			} else {
				this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
			}
			const bufferLength = Math.max(height, newLines.length);
			this.previousViewportTop = Math.max(0, bufferLength - height);
			this.positionHardwareCursor(cursorPos, newLines.length);
			this.previousLines = newLines;
			this.previousKittyImageIds = this.collectKittyImageIds(newLines);
			this.previousWidth = width;
			this.previousHeight = height;
		};

		const debugRedraw = process.env.PI_DEBUG_REDRAW === "1";
		const logRedraw = (reason: string): void => {
			if (!debugRedraw) return;
			const logPath = join(homedir(), ".pi", "agent", "pi-debug.log");
			const msg = `[${new Date().toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})\n`;
			appendFileSync(logPath, msg);
		};

		// First render
		if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
			logRedraw("first render");
			fullRender(false);
			return;
		}

		// Width changed
		if (widthChanged) {
			logRedraw(`terminal width changed (${this.previousWidth} -> ${width})`);
			fullRender(true);
			return;
		}

		// Height changed
		if (heightChanged && !isTermuxSession()) {
			logRedraw(`terminal height changed (${this.previousHeight} -> ${height})`);
			fullRender(true);
			return;
		}

		// Content shrunk
		if (
			this.clearOnShrink &&
			newLines.length < this.maxLinesRendered &&
			this.overlayStack.length === 0
		) {
			logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
			fullRender(true);
			return;
		}

		// Find first and last changed lines
		let firstChanged = -1;
		let lastChanged = -1;
		const maxLines = Math.max(newLines.length, this.previousLines.length);
		for (let i = 0; i < maxLines; i++) {
			const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
			const newLine = i < newLines.length ? newLines[i] : "";
			if (oldLine !== newLine) {
				if (firstChanged === -1) firstChanged = i;
				lastChanged = i;
			}
		}

		const appendedLines = newLines.length > this.previousLines.length;
		if (appendedLines) {
			if (firstChanged === -1) firstChanged = this.previousLines.length;
			lastChanged = newLines.length - 1;
		}

		if (firstChanged !== -1) {
			lastChanged = this.expandLastChangedForKittyImages(firstChanged, lastChanged);
		}

		const appendStart =
			appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;

		// No changes
		if (firstChanged === -1) {
			this.positionHardwareCursor(cursorPos, newLines.length);
			this.previousViewportTop = prevViewportTop;
			this.previousHeight = height;
			return;
		}

		// All changes in deleted lines
		if (firstChanged >= newLines.length) {
			if (this.previousLines.length > newLines.length) {
				let buffer = "\x1b[?2026h";
				buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);
				const targetRow = Math.max(0, newLines.length - 1);
				if (targetRow < prevViewportTop) {
					logRedraw(`deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`);
					fullRender(true);
					return;
				}
				const lineDiff = computeLineDiff(targetRow);
				if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
				else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
				buffer += "\r";
				const extraLines = this.previousLines.length - newLines.length;
				if (extraLines > height) {
					logRedraw(`extraLines > height (${extraLines} > ${height})`);
					fullRender(true);
					return;
				}
				if (extraLines > 0) buffer += "\x1b[1B";
				for (let i = 0; i < extraLines; i++) {
					buffer += "\r\x1b[2K";
					if (i < extraLines - 1) buffer += "\x1b[1B";
				}
				if (extraLines > 0) buffer += `\x1b[${extraLines}A`;
				buffer += "\x1b[?2026l";
				this.terminal.write(buffer);
				this.cursorRow = targetRow;
				this.hardwareCursorRow = targetRow;
			}
			this.positionHardwareCursor(cursorPos, newLines.length);
			this.previousLines = newLines;
			this.previousKittyImageIds = this.collectKittyImageIds(newLines);
			this.previousWidth = width;
			this.previousHeight = height;
			this.previousViewportTop = prevViewportTop;
			return;
		}

		// ┌─────────────────────────────────────────────────────────────────┐
		// │ COOLDOWN PATCH — the ONLY intentional difference from upstream. │
		// │ Original: fullRender(true) when firstChanged < prevViewportTop. │
		// │ Patched:  clamp firstChanged to prevViewportTop when cooldown   │
		// │           is active and not expired.                            │
		// └─────────────────────────────────────────────────────────────────┘
		if (firstChanged < prevViewportTop) {
			const now = Date.now();
			const cooldownExpired = now - state.lastFullRedrawMs >= config.intervalMs;

			if (state.active && !cooldownExpired) {
				logRedraw(
					`cooldown: clamped firstChanged ${firstChanged} -> ${prevViewportTop} (${config.intervalMs - (now - state.lastFullRedrawMs)}ms remaining)`,
				);
				firstChanged = prevViewportTop;
				// Recalculate lastChanged within viewport range
				lastChanged = -1;
				for (let i = firstChanged; i < maxLines; i++) {
					const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
					const newLine = i < newLines.length ? newLines[i] : "";
					if (oldLine !== newLine) lastChanged = i;
				}
				if (appendedLines) lastChanged = newLines.length - 1;
				// No visible changes after clamping — update state silently
				if (lastChanged === -1) {
					this.previousLines = newLines;
					this.previousKittyImageIds = this.collectKittyImageIds(newLines);
					this.previousWidth = width;
					this.previousHeight = height;
					this.previousViewportTop = prevViewportTop;
					this.positionHardwareCursor(cursorPos, newLines.length);
					return;
				}
			} else {
				state.lastFullRedrawMs = Date.now();
				logRedraw(`firstChanged < viewportTop (${firstChanged} < ${prevViewportTop})`);
				fullRender(true);
				return;
			}
		}

		// Differential render
		let buffer = "\x1b[?2026h";
		buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);

		const prevViewportBottom = prevViewportTop + height - 1;
		const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;

		if (moveTargetRow > prevViewportBottom) {
			const currentScreenRow = Math.max(
				0,
				Math.min(height - 1, hardwareCursorRow - prevViewportTop),
			);
			const moveToBottom = height - 1 - currentScreenRow;
			if (moveToBottom > 0) buffer += `\x1b[${moveToBottom}B`;
			const scroll = moveTargetRow - prevViewportBottom;
			buffer += "\r\n".repeat(scroll);
			prevViewportTop += scroll;
			viewportTop += scroll;
			hardwareCursorRow = moveTargetRow;
		}

		const lineDiff = computeLineDiff(moveTargetRow);
		if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
		else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
		buffer += appendStart ? "\r\n" : "\r";

		const renderEnd = Math.min(lastChanged, newLines.length - 1);
		for (let i = firstChanged; i <= renderEnd; i++) {
			if (i > firstChanged) buffer += "\r\n";
			buffer += "\x1b[2K";
			const line = newLines[i];
			const lineIsImage = isImageLine(line);
			if (!lineIsImage && visibleWidth(line) > width) {
				const crashLogPath = join(homedir(), ".pi", "agent", "pi-crash.log");
				const crashData = [
					`Crash at ${new Date().toISOString()}`,
					`Terminal width: ${width}`,
					`Line ${i} visible width: ${visibleWidth(line)}`,
					"",
					"=== All rendered lines ===",
					...newLines.map((l: string, idx: number) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
					"",
				].join("\n");
				mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
				writeFileSync(crashLogPath, crashData);
				this.stop();
				throw new Error(
					`Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).\n\nDebug log written to: ${crashLogPath}`,
				);
			}
			buffer += line;
		}

		let finalCursorRow = renderEnd;

		if (this.previousLines.length > newLines.length) {
			if (renderEnd < newLines.length - 1) {
				const moveDown = newLines.length - 1 - renderEnd;
				buffer += `\x1b[${moveDown}B`;
				finalCursorRow = newLines.length - 1;
			}
			const extraLines = this.previousLines.length - newLines.length;
			for (let i = newLines.length; i < this.previousLines.length; i++) {
				buffer += "\r\n\x1b[2K";
			}
			buffer += `\x1b[${extraLines}A`;
		}

		buffer += "\x1b[?2026l";

		if (process.env.PI_TUI_DEBUG === "1") {
			const debugDir = "/tmp/tui";
			mkdirSync(debugDir, { recursive: true });
			const debugPath = join(
				debugDir,
				`render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
			);
			writeFileSync(
				debugPath,
				[
					`firstChanged: ${firstChanged}`,
					`viewportTop: ${viewportTop}`,
					`cursorRow: ${this.cursorRow}`,
					`height: ${height}`,
					`lineDiff: ${lineDiff}`,
					`hardwareCursorRow: ${hardwareCursorRow}`,
					`renderEnd: ${renderEnd}`,
					`finalCursorRow: ${finalCursorRow}`,
					`cursorPos: ${JSON.stringify(cursorPos)}`,
					`newLines.length: ${newLines.length}`,
					`previousLines.length: ${this.previousLines.length}`,
					"",
					"=== newLines ===",
					JSON.stringify(newLines, null, 2),
					"",
					"=== previousLines ===",
					JSON.stringify(this.previousLines, null, 2),
					"",
					"=== buffer ===",
					JSON.stringify(buffer),
				].join("\n"),
			);
		}

		this.terminal.write(buffer);
		this.cursorRow = Math.max(0, newLines.length - 1);
		this.hardwareCursorRow = finalCursorRow;
		this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
		this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);
		this.positionHardwareCursor(cursorPos, newLines.length);
		this.previousLines = newLines;
		this.previousKittyImageIds = this.collectKittyImageIds(newLines);
		this.previousWidth = width;
		this.previousHeight = height;
	};
	// --- FORK END ---
}
