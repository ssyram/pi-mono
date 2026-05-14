import type { KeybindingsManager, Theme } from "@mariozechner/pi-coding-agent";
import { Component, Input, truncateToWidth } from "@mariozechner/pi-tui";
import { buildChanges } from "./build-changes.js";
import type { PreflightIssue } from "./apply-changes.js";
import { preflightChanges } from "./apply-changes.js";
import { createKeyMap } from "./key-map.js";
import { renderScopeToken } from "./render-scope-token.js";
import type { ExtensionState } from "./resolve-state.js";
import { normalizeSearch, matchesSearch, searchableText } from "./search.js";
import { getState, toggleField } from "./state-helpers.js";
import type { ActionId, Focus, ListResult, Pending } from "./types.js";

const DEFAULT_MAX_VISIBLE_ROWS = 8;
const MIN_VISIBLE_ROWS = 1;
const CHROME_ROWS = 5;

type BindingConcept = {
	bindings: string[];
	label: string;
};

type BindingConflict = {
	concepts: string[];
	key: string;
	state: Focus;
};

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function resolveBindings(kb: KeybindingsManager, ids: string[]): string[] {
	const resolved = ids.map((id) => {
		const keys = kb.getKeys(id as never);
		return keys.length > 0 ? keys : [id];
	});
	return unique(resolved.flat());
}

function findBindingConflicts(kb: KeybindingsManager): BindingConflict[] {
	const states: Array<{ concepts: BindingConcept[]; state: Focus }> = [
		{
			state: "list",
			concepts: [
				{ label: "cancel", bindings: ["tui.select.cancel", "escape", "ctrl+c"] },
				{ label: "edit scope", bindings: ["tui.select.confirm", "enter"] },
				{ label: "move up", bindings: ["tui.select.up", "up"] },
				{ label: "move down", bindings: ["tui.select.down", "down"] },
				{
					label: "open actions",
					bindings: ["tui.input.tab", "tab", "shift+tab"],
				},
				{
					label: "search editing",
					bindings: ["left", "right", "space"],
				},
			],
		},
		{
			state: "scope",
			concepts: [
				{
					label: "back to list",
					bindings: ["tui.select.cancel", "escape", "ctrl+c", "tui.select.confirm", "enter"],
				},
				{
					label: "open actions",
					bindings: ["tui.input.tab", "tab", "shift+tab"],
				},
				{ label: "move up", bindings: ["tui.select.up", "up"] },
				{ label: "move down", bindings: ["tui.select.down", "down"] },
				{ label: "choose Local", bindings: ["left"] },
				{ label: "choose Global", bindings: ["right"] },
				{
					label: "toggle scope",
					bindings: ["space"],
				},
			],
		},
		{
			state: "actions",
			concepts: [
				{
					label: "back to list",
					bindings: [
						"tui.select.cancel",
						"escape",
						"ctrl+c",
						"tui.input.tab",
						"tab",
						"shift+tab",
					],
				},
				{ label: "move left", bindings: ["left"] },
				{ label: "move right", bindings: ["right"] },
				{
					label: "activate action",
					bindings: ["tui.select.confirm", "enter", "space"],
				},
			],
		},
	];

	const conflicts = new Map<string, BindingConflict>();
	for (const { state, concepts } of states) {
		for (let i = 0; i < concepts.length; i++) {
			for (let j = i + 1; j < concepts.length; j++) {
				const left = concepts[i]!;
				const right = concepts[j]!;
				const overlap = resolveBindings(kb, left.bindings).filter((key) =>
					resolveBindings(kb, right.bindings).includes(key),
				);
				for (const key of overlap) {
					const labels = [left.label, right.label].sort();
					const conflictKey = `${state}:${key}:${labels.join("|")}`;
					conflicts.set(conflictKey, { state, key, concepts: labels });
				}
			}
		}
	}
	return [...conflicts.values()].sort((a, b) =>
		a.state === b.state
			? a.key.localeCompare(b.key)
			: a.state.localeCompare(b.state),
	);
}

export function buildListComponent(
	states: ExtensionState[],
	pending: Pending,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (result: ListResult) => void,
	projectExtDir?: string,
	globalExtDir?: string,
	preflightIssues: PreflightIssue[] = [],
): Component {
	const keys = createKeyMap(keybindings);
	const bindingConflicts = findBindingConflicts(keybindings);
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

	function keyText(ids: string | string[]): string {
		const resolved = resolveBindings(keybindings, Array.isArray(ids) ? ids : [ids]);
		if (resolved.length === 0) return "";
		if (resolved.length === 1) return resolved[0]!;
		return resolved.join("/");
	}

	function getTerminalRows(): number {
		return process.stdout.rows || 24;
	}

	function getVisibleItemCapacity(): number {
		return Math.max(
			MIN_VISIBLE_ROWS,
			Math.min(DEFAULT_MAX_VISIBLE_ROWS, getTerminalRows() - CHROME_ROWS),
		);
	}

	function changeCount(): number {
		return pending.size;
	}

	function currentPreflightIssues(): PreflightIssue[] {
		if (!projectExtDir || !globalExtDir) return preflightIssues;
		return preflightChanges(buildChanges(states, pending), projectExtDir, globalExtDir);
	}

	function blockingIssueCount(): number {
		return currentPreflightIssues().filter((issue) => issue.severity === "error").length;
	}

	function bindingConflictCount(): number {
		return bindingConflicts.length;
	}

	function canApply(): boolean {
		return changeCount() > 0 && blockingIssueCount() === 0;
	}

	function selectedState(): ExtensionState | null {
		if (filtered.length === 0) return null;
		return filtered[selectedIndex] ?? null;
	}

	function selectedLabel(): string {
		const state = selectedState();
		if (!state) return "No extension selected";
		return `${state.extension.repoName}/${state.extension.name}`;
	}

	function currentScopeLabel(): string {
		return column === 0 ? "Local" : "Global";
	}

	function setColumn(next: number): void {
		const resolved = next === 0 ? 0 : 1;
		if (column === resolved) {
			statusMessage = `${currentScopeLabel()} already selected`;
			cancelArmed = false;
			return;
		}
		column = resolved;
		statusMessage = "";
		cancelArmed = false;
	}

	function bindingConflictSummary(): string {
		if (bindingConflicts.length === 0) return "";
		const first = bindingConflicts[0]!;
		const more =
			bindingConflicts.length > 1 ? ` (+${bindingConflicts.length - 1} more)` : "";
		return `Keybinding conflict: ${first.state} ${first.key} → ${first.concepts.join(" / ")}${more}`;
	}

	function issueSummary(): string {
		const parts: string[] = [];
		const issues = currentPreflightIssues();
		const blocking = issues.filter((issue) => issue.severity === "error").length;
		if (blocking > 0) {
			parts.push(`${blocking} blocking`);
		} else if (issues.length > 0) {
			parts.push(`${issues.length} warning${issues.length === 1 ? "" : "s"}`);
		}
		if (bindingConflictCount() > 0) {
			parts.push(
				`${bindingConflictCount()} key conflict${bindingConflictCount() === 1 ? "" : "s"}`,
			);
		}
		return parts.join(" · ");
	}

	function selectedStatusSummary(): string {
		const state = selectedState();
		if (!state) return filtered.length === 0 ? "No matching extensions" : `${filtered.length} matching`;
		const current = getState(pending, state);
		const parts = [
			selectedLabel(),
			`${current.local ? "L✓" : "L·"} ${current.global ? "G✓" : "G·"}`,
			focus === "scope"
				? `scope picker ${currentScopeLabel()}`
				: `scope ${currentScopeLabel()}`,
		];
		if (changeCount() > 0) parts.push(`${changeCount()} pending`);
		const issues = issueSummary();
		if (issues) parts.push(issues);
		return parts.join(" · ");
	}

	function contextLine(): string {
		if (statusMessage) return theme.fg("warning", statusMessage);
		if (cancelArmed)
			return theme.fg("warning", `Press ${keyText(["tui.select.cancel", "escape", "ctrl+c"])} again to cancel and exit`);
		if (bindingConflicts.length > 0) return theme.fg("warning", bindingConflictSummary());
		return theme.fg("muted", selectedStatusSummary());
	}

	function helpLine(): string {
		const upDown = `${keyText(["tui.select.up", "up"])}/${keyText(["tui.select.down", "down"])}`;
		const leftRight = `${keyText("left")}/${keyText("right")}`;
		const tabKeys = `${keyText(["tui.input.tab", "tab"])}/${keyText("shift+tab")}`;
		const confirm = keyText(["tui.select.confirm", "enter"]);
		const cancel = keyText(["tui.select.cancel", "escape", "ctrl+c"]);
		const toggle = keyText("space");

		if (focus === "scope") {
			return [
				`${upDown} move`,
				`${leftRight} choose L/G`,
				`${toggle} toggle`,
				`${confirm}/${cancel} list`,
				`${tabKeys} actions`,
			].join(" · ");
		}
		if (focus === "actions") {
			return [
				`${leftRight} move`,
				`${confirm}/${toggle} activate`,
				`${tabKeys}/${cancel} list`,
			].join(" · ");
		}
		if (searchInput.getValue().length > 0) {
			return [
				"Type search",
				`${upDown} move`,
				`${confirm} edit scope`,
				`${tabKeys} actions`,
				`${cancel} clear`,
			].join(" · ");
		}
		return [
			"Type search",
			`${upDown} move`,
			`${confirm} edit scope`,
			`${tabKeys} actions`,
			cancelArmed ? `${cancel} exit` : `${cancel} arm cancel`,
		].join(" · ");
	}

	function applyFilter(): void {
		const q = normalizeSearch(searchInput.getValue());
		filtered = q ? states.filter((s) => matchesSearch(q, searchableText(s))) : states;
		selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
		ensureSelectionVisible(Math.max(1, getVisibleItemCapacity() - 1));
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
		ensureSelectionVisible(Math.max(1, getVisibleItemCapacity() - 1));
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
		ensureSelectionVisible(Math.max(1, getVisibleItemCapacity() - 1));
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
		ensureSelectionVisible(Math.max(1, getVisibleItemCapacity() - 1));
	}

	function activateCurrentAction(): void {
		const action = actions[actionIndex];
		if (action === "apply") {
			if (!canApply()) {
				if (changeCount() === 0) {
					statusMessage = "No pending changes to apply";
				} else {
					statusMessage = `Cannot apply: ${blockingIssueCount()} blocking issue(s)`;
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

	function buildTitleLine(width: number): string {
		const modeName = focus === "list" ? "List" : focus === "scope" ? "Scope" : "Actions";
		const meta = [
			theme.fg("muted", `[${modeName}]`),
			theme.fg("muted", `${filtered.length}/${states.length}`),
		];
		if (changeCount() > 0) meta.push(theme.fg("warning", `${changeCount()} pending`));
		const issues = issueSummary();
		if (issues) meta.push(theme.fg("warning", issues));
		return truncateToWidth(`${theme.bold("Manage Extensions")} ${meta.join(" · ")}`, width);
	}

	function buildRow(state: ExtensionState, selected: boolean, width: number): string {
		const current = getState(pending, state);
		const localActive = selected && focus === "scope" && column === 0;
		const globalActive = selected && focus === "scope" && column === 1;
		const localChanged = current.local !== state.local;
		const globalChanged = current.global !== state.global;
		const prefix = selected ? theme.fg("accent", "→ ") : "  ";
		const localToken = renderScopeToken(theme, "L", current.local, localActive, localChanged);
		const globalToken = renderScopeToken(theme, "G", current.global, globalActive, globalChanged);
		const labelBase = `${state.extension.repoName}/${state.extension.name}`;
		const label = selected ? theme.fg("accent", labelBase) : labelBase;
		return truncateToWidth(`${prefix}${localToken}  ${globalToken}  ${label}`, width);
	}

	function buildListLines(width: number): string[] {
		const visibleRows = getVisibleItemCapacity();
		if (visibleRows <= 1) {
			if (filtered.length === 0) {
				return [theme.fg("muted", truncateToWidth("  No matching extensions", width))];
			}
			ensureSelectionVisible(1);
			return [buildRow(filtered[selectedIndex]!, true, width)];
		}

		const itemRows = visibleRows - 1;
		ensureSelectionVisible(itemRows);
		const end = Math.min(filtered.length, scrollOffset + itemRows);
		const lines: string[] = [];

		if (filtered.length === 0) {
			lines.push(theme.fg("muted", truncateToWidth("  No matching extensions", width)));
		} else {
			for (let i = scrollOffset; i < end; i++) {
				lines.push(buildRow(filtered[i]!, i === selectedIndex, width));
			}
		}

		while (lines.length < itemRows) lines.push("");

		const indicator =
			filtered.length === 0
				? "  (0/0)"
				: `  (${Math.min(selectedIndex + 1, filtered.length)}/${filtered.length})`;
		lines.push(theme.fg("muted", truncateToWidth(indicator, width)));
		return lines;
	}

	function buildActionBar(width: number): string {
		const actionBar = actions
			.map((action, index) => {
				const isActive = focus === "actions" && index === actionIndex;
				const disabled = action === "apply" && !canApply();
				const label = action === "apply" ? "Apply" : action === "list" ? "List" : "Cancel";
				const base = `[${label}]`;
				if (disabled) return theme.fg("muted", base);
				if (isActive) return theme.fg("accent", base);
				return base;
			})
			.join(" ");
		return truncateToWidth(actionBar, width);
	}

	return {
		render(width: number): string[] {
			return [
				buildTitleLine(width),
				truncateToWidth(searchInput.render(Math.max(1, width - 2)).join(""), width),
				truncateToWidth(contextLine(), width),
				...buildListLines(width),
				buildActionBar(width),
				theme.fg("muted", truncateToWidth(helpLine(), width)),
			];
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
					statusMessage = "";
					return;
				}
				if (keys.right(data)) {
					actionIndex = (actionIndex + 1) % actions.length;
					statusMessage = "";
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
					setColumn(0);
					return;
				}
				if (keys.right(data)) {
					setColumn(1);
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
