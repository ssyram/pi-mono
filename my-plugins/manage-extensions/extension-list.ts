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
		if (searchInput.getValue().length > 0) return theme.fg("muted", "Esc clears search");
		if (focus === "actions") return theme.fg("muted", "Esc returns to list");
		return theme.fg("muted", "Esc twice = cancel and exit");
	}

	function selectedState() {
		if (filtered.length === 0) return null;
		return filtered[selectedIndex] ?? null;
	}

	function moveSelection(delta: number): void {
		if (filtered.length === 0) return;
		selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
		cancelArmed = false;
	}

	function moveColumn(next: number): void {
		column = next;
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

	return {
		render(width: number): string[] {
			const lines: string[] = [];
			const title = theme.bold("Manage Extensions");
			const mode = theme.fg("muted", focus === "list" ? "[List]" : "[Actions]");
			const pendingLabel = changeCount() > 0 ? theme.fg("warning", ` ${changeCount()} pending`) : "";
			lines.push(truncateToWidth(`${title} ${mode}${pendingLabel}`, width));
			lines.push(truncateToWidth(cancelHint(), width));
			lines.push(truncateToWidth(searchInput.render(width - 2).join(""), width));
			lines.push("");

			if (filtered.length === 0) {
				lines.push(theme.fg("muted", truncateToWidth("  No matching extensions", width)));
			} else {
				const visible = 20;
				const start = Math.max(
					0,
					Math.min(selectedIndex - Math.floor(visible / 2), filtered.length - visible),
				);
				const end = Math.min(filtered.length, start + visible);
				for (let i = start; i < end; i++) {
					const state = filtered[i];
					const current = getState(pending, state);
					const selected = i === selectedIndex;
					const localActive = selected && focus === "list" && column === 0;
					const globalActive = selected && focus === "list" && column === 1;
					const localChanged = current.local !== state.local;
					const globalChanged = current.global !== state.global;
					const prefix = selected ? theme.fg("accent", "→ ") : "  ";
					const localToken = renderScopeToken(theme, "L", current.local, localActive, localChanged);
					const globalToken = renderScopeToken(theme, "G", current.global, globalActive, globalChanged);
					const labelBase = `${state.extension.repoName}/${state.extension.name}`;
					const label =
						selected && focus === "list" ? theme.fg("accent", labelBase) : labelBase;
					lines.push(
						truncateToWidth(`${prefix}${localToken}  ${globalToken}  ${label}`, width),
					);
				}
				if (start > 0 || end < filtered.length) {
					lines.push(
						theme.fg(
							"muted",
							truncateToWidth(`  (${selectedIndex + 1}/${filtered.length})`, width),
						),
					);
				}
			}

			lines.push("");
			const active = selectedState();
			if (active) {
				lines.push(
					theme.fg("muted", truncateToWidth(`Path: ${active.extension.absolutePath}`, width)),
				);
				const colColor = column === 0 ? ("warning" as const) : ("success" as const);
				const colLabel =
					column === 0 ? "Local (.pi/extensions)" : "Global (~/.pi/agent/extensions)";
				lines.push(theme.fg(colColor, truncateToWidth(`▸ ${colLabel}`, width)));
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
						: theme.fg(
								"muted",
								`Preflight issues: ${preflightIssues.length} warning(s)`,
							);
				lines.push(truncateToWidth(summary, width));
				for (const issue of preflightIssues.slice(0, 3)) {
					const row = `- ${issue.extensionName}: ${issue.message}`;
					const styled =
						issue.severity === "error"
							? theme.fg("warning", row)
							: theme.fg("muted", row);
					lines.push(truncateToWidth(styled, width));
				}
				if (preflightIssues.length > 3) {
					lines.push(
						theme.fg(
							"muted",
							truncateToWidth(
								`...and ${preflightIssues.length - 3} more issue(s)`,
								width,
							),
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
					? "Type to search · ↑/↓ move · ←/→ Local/Global · Space toggle · Tab actions"
					: "←/→ move · Enter activate · Tab return to list";
			lines.push(theme.fg("muted", truncateToWidth(help, width)));
			return lines;
		},

		handleInput(data: string): void {
			if (keys.cancel(data)) {
				// Priority 1: clear search if active
				if (searchInput.getValue().length > 0) {
					searchInput.setValue("");
					applyFilter();
					cancelArmed = false;
					return;
				}
				// Priority 2: return to list from actions
				if (focus === "actions") {
					focusList();
					cancelArmed = false;
					return;
				}
				// Priority 3: two-press cancel
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
				toggleSelected();
				return;
			}
			searchInput.handleInput(data);
			applyFilter();
		},

		invalidate(): void {},
	};
}
