import type { Theme } from "@mariozechner/pi-coding-agent";
import { Component, Input, truncateToWidth } from "@mariozechner/pi-tui";
import type { ExtensionState } from "./resolve-state.js";
import type { PreflightIssue } from "./apply-changes.js";
import type { Pending, Focus, ActionId, ListResult } from "./types.js";
import { createKeyMap } from "./key-map.js";
import { getState, toggleField } from "./state-helpers.js";
import { renderScopeToken } from "./render-scope-token.js";
import { normalizeSearch, matchesSearch, searchableText } from "./search.js";

export function buildListComponent(
	states: ExtensionState[],
	pending: Pending,
	theme: Theme,
	done: (result: ListResult) => void,
	preflightIssues: PreflightIssue[] = [],
): Component {
	const keys = createKeyMap();
	let selectedIndex = 0;
	let scrollOffset = 0;
	let column = 0;
	let focus: Focus = "list";
	let actionIndex = 0;
	let cancelArmed = false;
	let statusMessage = "";
	const actions: ActionId[] = ["apply", "list", "cancel"];
	const searchInput = new Input();
	searchInput.focused = true;
	let filtered = states;

	function applyFilter() {
		const q = normalizeSearch(searchInput.getValue());
		filtered = q ? states.filter((s) => matchesSearch(q, searchableText(s))) : states;
		selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
		ensureSelectionVisible(getVisibleItemCapacity());
	}

	function getTerminalRows(): number {
		return process.stdout.rows || 24;
	}

	function changeCount(): number {
		return pending.size;
	}

	function blockingIssueCount(): number {
		return preflightIssues.filter((issue) => issue.severity === "error").length;
	}

	function canApply(): boolean {
		return changeCount() > 0 && blockingIssueCount() === 0;
	}

	function cancelHint(): string {
		if (cancelArmed) return theme.fg("warning", "Press Esc again to cancel and exit");
		if (focus === "scope") return theme.fg("muted", "Esc exits scope picker");
		if (focus === "actions") return theme.fg("muted", "Esc returns to list");
		if (searchInput.getValue().length > 0) return theme.fg("muted", "Esc clears search");
		return theme.fg("muted", "Esc twice = cancel and exit");
	}

	function selectedState() {
		if (filtered.length === 0) return null;
		return filtered[selectedIndex] ?? null;
	}

	function countFooterLines(): number {
		let count = 0;
		count += 1; // spacer before details
		if (selectedState()) count += 2; // path + scope hint
		count += 1; // pending changes
		if (preflightIssues.length > 0) {
			count += 1; // summary
			count += Math.min(preflightIssues.length, 3);
			if (preflightIssues.length > 3) count += 1;
		}
		count += 1; // spacer before actions
		count += 1; // action bar
		if (statusMessage) count += 1;
		count += 1; // help text
		return count;
	}

	function getListRowBudget(): number {
		const headerLines = 4;
		return Math.max(1, getTerminalRows() - headerLines - countFooterLines());
	}

	function getVisibleItemCapacity(): number {
		const rowBudget = getListRowBudget();
		if (filtered.length <= rowBudget) return rowBudget;
		return Math.max(1, rowBudget - 1);
	}

	function ensureSelectionVisible(visibleItems: number): void {
		if (filtered.length === 0) {
			scrollOffset = 0;
			return;
		}
		const maxOffset = Math.max(0, filtered.length - visibleItems);
		scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
		if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
		if (selectedIndex >= scrollOffset + visibleItems) {
			scrollOffset = selectedIndex - visibleItems + 1;
		}
	}

	function moveSelection(delta: number): void {
		if (filtered.length === 0) return;
		selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
		ensureSelectionVisible(getVisibleItemCapacity());
		statusMessage = "";
		cancelArmed = false;
	}

	function moveColumn(next: number): void {
		column = next;
		statusMessage = "";
		cancelArmed = false;
	}

	function toggleSelected(): void {
		const state = selectedState();
		if (!state) return;
		toggleField(pending, state, column === 0 ? "local" : "global");
		statusMessage = "";
		cancelArmed = false;
	}

	function focusActions(): void {
		focus = "actions";
		actionIndex = canApply() ? 0 : 1;
		statusMessage = "";
		cancelArmed = false;
		searchInput.focused = false;
	}

	function focusList(): void {
		focus = "list";
		statusMessage = "";
		cancelArmed = false;
		searchInput.focused = true;
		ensureSelectionVisible(getVisibleItemCapacity());
	}

	function focusScope(): void {
		if (!selectedState()) {
			statusMessage = "No extension selected";
			return;
		}
		focus = "scope";
		statusMessage = "";
		cancelArmed = false;
		searchInput.focused = false;
		ensureSelectionVisible(getVisibleItemCapacity());
	}

	function activateCurrentAction(): void {
		const action = actions[actionIndex];
		if (action === "apply") {
			if (!canApply()) {
				if (changeCount() === 0) {
					statusMessage = "No pending changes to apply";
				} else {
					statusMessage = `Cannot apply: ${blockingIssueCount()} blocking issue(s) must be resolved first`;
				}
				return;
			}
			done({ action: "apply" });
			return;
		}
		if (action === "list") {
			focusList();
			return;
		}
		done({ action: "cancel" });
	}

	function buildHeaderLines(width: number): string[] {
		const title = theme.bold("Manage Extensions");
		const modeName = focus === "list" ? "List" : focus === "scope" ? "Scope" : "Actions";
		const mode = theme.fg("muted", `[${modeName}]`);
		const pendingLabel = changeCount() > 0 ? theme.fg("warning", ` ${changeCount()} pending`) : "";
		return [
			truncateToWidth(`${title} ${mode}${pendingLabel}`, width),
			truncateToWidth(cancelHint(), width),
			truncateToWidth(searchInput.render(width - 2).join(""), width),
			"",
		];
	}

	function buildListLines(width: number, rowBudget: number): string[] {
		if (filtered.length === 0) {
			return [theme.fg("muted", truncateToWidth("  No matching extensions", width))];
		}

		const needsIndicator = filtered.length > rowBudget;
		const visibleItems = needsIndicator ? Math.max(1, rowBudget - 1) : rowBudget;
		ensureSelectionVisible(visibleItems);
		const end = Math.min(filtered.length, scrollOffset + visibleItems);
		const lines: string[] = [];

		for (let i = scrollOffset; i < end; i++) {
			const state = filtered[i];
			const current = getState(pending, state);
			const selected = i === selectedIndex;
			const localActive = selected && focus === "scope" && column === 0;
			const globalActive = selected && focus === "scope" && column === 1;
			const localChanged = current.local !== state.local;
			const globalChanged = current.global !== state.global;
			const prefix = selected ? theme.fg("accent", "→ ") : "  ";
			const localToken = renderScopeToken(theme, "L", current.local, localActive, localChanged);
			const globalToken = renderScopeToken(theme, "G", current.global, globalActive, globalChanged);
			const labelBase = `${state.extension.repoName}/${state.extension.name}`;
			const label = selected && focus !== "actions" ? theme.fg("accent", labelBase) : labelBase;
			lines.push(truncateToWidth(`${prefix}${localToken}  ${globalToken}  ${label}`, width));
		}

		if (needsIndicator) {
			lines.push(
				theme.fg(
					"muted",
					truncateToWidth(`  (${selectedIndex + 1}/${filtered.length})`, width),
				),
			);
		}

		return lines;
	}

	function buildFooterLines(width: number): string[] {
		const lines: string[] = [];
		const active = selectedState();
		lines.push("");
		if (active) {
			lines.push(
				theme.fg("muted", truncateToWidth(`Path: ${active.extension.absolutePath}`, width)),
			);
			const colColor = column === 0 ? ("warning" as const) : ("success" as const);
			const colLabel =
				column === 0 ? "Local (.pi/extensions)" : "Global (~/.pi/agent/extensions)";
			const scopePrefix = focus === "scope" ? "▸ Scope picker:" : "▸ Current scope:";
			lines.push(theme.fg(colColor, truncateToWidth(`${scopePrefix} ${colLabel}`, width)));
		}
		lines.push(theme.fg("muted", `Pending changes: ${changeCount()}`));
		if (preflightIssues.length > 0) {
			const blocking = blockingIssueCount();
			const summary =
				blocking > 0
					? theme.fg(
							"warning",
							`Preflight issues: ${preflightIssues.length} (${blocking} blocking)`,
						)
					: theme.fg("muted", `Preflight issues: ${preflightIssues.length} warning(s)`);
			lines.push(truncateToWidth(summary, width));
			for (const issue of preflightIssues.slice(0, 3)) {
				const row = `- ${issue.extensionName}: ${issue.message}`;
				const styled =
					issue.severity === "error" ? theme.fg("warning", row) : theme.fg("muted", row);
				lines.push(truncateToWidth(styled, width));
			}
			if (preflightIssues.length > 3) {
				lines.push(
					theme.fg(
						"muted",
						truncateToWidth(`...and ${preflightIssues.length - 3} more issue(s)`, width),
					),
				);
			}
		}
		lines.push("");

		const actionBar = actions
			.map((action, index) => {
				const active = focus === "actions" && index === actionIndex;
				const disabled = action === "apply" && !canApply();
				const label =
					action === "apply"
						? "Apply Changes"
						: action === "list"
							? "Back to List"
							: "Cancel";
				const base = `[${label}]`;
				if (disabled) return theme.fg("muted", base);
				if (active) return theme.fg("accent", base);
				return base;
			})
			.join(" ");
		lines.push(truncateToWidth(actionBar, width));

		if (statusMessage) {
			lines.push(theme.fg("warning", truncateToWidth(statusMessage, width)));
		}

		const help =
			focus === "list"
				? "Type to search · ↑/↓ move · Enter scope · Tab actions"
				: focus === "scope"
					? "↑/↓ move · ←/→ choose L/G · Space toggle · Enter/Esc done"
					: "←/→ move · Enter activate · Tab return to list";
		lines.push(theme.fg("muted", truncateToWidth(help, width)));
		return lines;
	}

	return {
		render(width: number): string[] {
			const headerLines = buildHeaderLines(width);
			const listLines = buildListLines(width, getListRowBudget());
			const footerLines = buildFooterLines(width);
			return [...headerLines, ...listLines, ...footerLines];
		},

		handleInput(data: string): void {
			if (keys.cancel(data)) {
				if (focus === "scope") {
					focusList();
					return;
				}
				if (focus === "actions") {
					focusList();
					return;
				}
				if (searchInput.getValue().length > 0) {
					searchInput.setValue("");
					applyFilter();
					cancelArmed = false;
					return;
				}
				if (cancelArmed) {
					done({ action: "cancel" });
					return;
				}
				cancelArmed = true;
				return;
			}
			cancelArmed = false;

			if (focus === "actions") {
				if (keys.tab(data) || keys.shiftTab(data)) {
					focusList();
					return;
				}
				if (keys.left(data)) {
					actionIndex = (actionIndex - 1 + actions.length) % actions.length;
					return;
				}
				if (keys.right(data)) {
					actionIndex = (actionIndex + 1) % actions.length;
					return;
				}
				if (keys.confirm(data) || keys.space(data)) {
					activateCurrentAction();
					return;
				}
				return;
			}

			if (focus === "scope") {
				if (keys.tab(data) || keys.shiftTab(data)) {
					focusActions();
					return;
				}
				if (keys.up(data)) {
					moveSelection(-1);
					return;
				}
				if (keys.down(data)) {
					moveSelection(1);
					return;
				}
				if (keys.left(data)) {
					moveColumn(0);
					return;
				}
				if (keys.right(data)) {
					moveColumn(1);
					return;
				}
				if (keys.space(data)) {
					toggleSelected();
					return;
				}
				if (keys.confirm(data)) {
					focusList();
					return;
				}
				return;
			}

			if (keys.tab(data)) {
				focusActions();
				return;
			}
			if (keys.shiftTab(data)) {
				// consume shift+tab in list mode to prevent it leaking into search field
				return;
			}
			if (keys.up(data)) {
				moveSelection(-1);
				return;
			}
			if (keys.down(data)) {
				moveSelection(1);
				return;
			}
			if (keys.confirm(data)) {
				focusScope();
				return;
			}
			searchInput.handleInput(data);
			applyFilter();
		},

		invalidate(): void {},
	};
}
