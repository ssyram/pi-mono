import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Turn } from "./turns.js";
import { serializeTurns } from "./turns.js";
import { outputResult } from "./output.js";
import { clampScrollOffset } from "./viewport.js";

interface PickerOptions {
	withTools: boolean;
	raw: boolean;
	append: boolean;
	noHeader: boolean;
	path: string | undefined;
}

interface PickerState {
	cursor: number;
	scrollOffset: number;
	selected: Set<number>;
	searchInput: Input;
	searching: boolean;
	filtered: number[];
	withTools: boolean;
	raw: boolean;
}

const MAX_VISIBLE = 10;

export async function showMessagePicker(turns: Turn[], opts: PickerOptions, ctx: ExtensionCommandContext) {
	if (turns.length === 0) {
		ctx.ui.notify("No messages in session", "warning");
		return;
	}

	return ctx.ui.custom<void>((tui, theme, keybindings, done) => {
		const state: PickerState = {
			cursor: turns.length - 1,
			scrollOffset: Math.max(0, turns.length - MAX_VISIBLE),
			selected: new Set<number>(),
			searchInput: new Input(),
			searching: false,
			filtered: turns.map((_, i) => i),
			withTools: opts.withTools,
			raw: opts.raw,
		};

		function applyFilter() {
			const q = state.searchInput.getValue().toLowerCase();
			if (!q) {
				state.filtered = turns.map((_, i) => i);
			} else {
				state.filtered = [];
				for (let i = 0; i < turns.length; i++) {
					if (turns[i].preview.toLowerCase().includes(q)) {
						state.filtered.push(i);
					}
				}
			}
			state.cursor = Math.min(state.cursor, state.filtered.length - 1);
			if (state.cursor < 0) state.cursor = 0;
			ensureVisible();
		}

		function ensureVisible() {
			state.scrollOffset = clampScrollOffset(state.scrollOffset, state.cursor, state.filtered.length, MAX_VISIBLE);
		}

		function finish() {
			const indices = state.selected.size > 0
				? [...state.selected].sort((a, b) => a - b)
				: [state.filtered[state.cursor]];

			const selectedTurns = indices.filter(i => i !== undefined).map(i => turns[i]);
			if (selectedTurns.length === 0) { done(undefined); return; }

			const text = serializeTurns(selectedTurns, state.raw, state.withTools, opts.noHeader);

			outputResult(text, opts.path, opts.append, ctx.cwd, (m, l) => ctx.ui.notify(m, l))
				.then(() => done(undefined))
				.catch(() => {
					ctx.ui.notify("Failed to save messages", "warning");
					done(undefined);
				});
		}

		function render(width: number): string[] {
			const lines: string[] = [];
			const selCount = state.selected.size;
			const title = `Save Messages${selCount > 0 ? `  [${selCount} selected]` : ""}`;
			const toggles = `[${state.withTools ? "x" : " "}] tools  [${state.raw ? "x" : " "}] raw`;
			lines.push(truncateToWidth(`${title}  ${toggles}`, width));
			lines.push("");

			if (state.searching) {
				lines.push(truncateToWidth(`/ ${state.searchInput.getValue()}_`, width));
			} else {
				lines.push(truncateToWidth("  (↑↓/jk move, / search, space select, a all, t tools, r raw, enter save, esc cancel)", width));
			}
			lines.push("");

			const visible = Math.min(MAX_VISIBLE, state.filtered.length);
			for (let vi = 0; vi < visible; vi++) {
				const idx = state.filtered[state.scrollOffset + vi];
				if (idx === undefined) break;
				const turn = turns[idx];
				const isCursor = (state.scrollOffset + vi) === state.cursor;
				const isSelected = state.selected.has(idx);
				const num = turns.length - idx;
				const prefix = isCursor ? ">" : " ";
				const check = isSelected ? "x" : " ";
				const role = turn.role === "user" ? "U" : "A";
				const preview = truncateToWidth(turn.preview, width - 14);
				lines.push(`${prefix} [${check}] [${num}] ${role}: ${preview}`);
			}

			if (state.filtered.length === 0) {
				lines.push("  (no matches)");
			}

			lines.push("");
			lines.push(truncateToWidth("[Enter: save] [Esc: cancel]", width));
			return lines;
		}

		function handleInput(data: string) {
			if (state.searching) {
				if (matchesKey(data, "escape") || matchesKey(data, "enter")) {
					state.searching = false;
				} else {
					state.searchInput.handleInput(data);
					applyFilter();
				}
				tui.requestRender();
				return;
			}

			if (matchesKey(data, "escape")) {
				done(undefined);
				return;
			}
			if (matchesKey(data, "enter")) {
				finish();
				return;
			}
			if (matchesKey(data, "/")) {
				state.searching = true;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "space")) {
				const idx = state.filtered[state.cursor];
				if (idx !== undefined) {
					if (state.selected.has(idx)) state.selected.delete(idx);
					else state.selected.add(idx);
				}
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "t")) {
				state.withTools = !state.withTools;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "r")) {
				state.raw = !state.raw;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "a")) {
				if (state.selected.size === state.filtered.length) {
					state.selected.clear();
				} else {
					for (const idx of state.filtered) state.selected.add(idx);
				}
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "up") || matchesKey(data, "k")) {
				if (state.cursor > 0) state.cursor--;
				ensureVisible();
				tui.requestRender();
				return;
			}
			if (matchesKey(data, "down") || matchesKey(data, "j")) {
				if (state.cursor < state.filtered.length - 1) state.cursor++;
				ensureVisible();
				tui.requestRender();
				return;
			}
		}

		return {
			render,
			handleInput,
			invalidate() {},
		};
	});
}
