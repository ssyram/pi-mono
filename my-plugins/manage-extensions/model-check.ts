import { getKeybindings, setKeybindings } from "@mariozechner/pi-tui";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";

type Focus = "list" | "scope" | "actions";
type ActionId = "apply" | "list" | "cancel";
type LogicalInput =
	| "cancel"
	| "confirm"
	| "tab"
	| "backTab"
	| "left"
	| "right"
	| "up"
	| "down"
	| "space"
	| "text";

type SimState = {
	focus: Focus;
	searchEmpty: boolean;
	cancelArmed: boolean;
	hasSelection: boolean;
	canApply: boolean;
	column: 0 | 1;
	action: ActionId;
};

type Transition = {
	nextFocus?: Focus;
	done?: "apply" | "cancel";
	action: string;
};

type Concept = {
	bindings: string[];
	label: string;
};

setKeybindings(new KeybindingsManager());
const kb = getKeybindings();

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function resolve(ids: string[]): string[] {
	return unique(ids.flatMap((id) => kb.getKeys(id as never)));
}

function transition(state: SimState, input: LogicalInput): Transition {
	if (input === "cancel") {
		if (state.focus === "scope") return { action: "back to list", nextFocus: "list" };
		if (state.focus === "actions") return { action: "back to list", nextFocus: "list" };
		if (!state.searchEmpty) return { action: "clear search", nextFocus: "list" };
		if (state.cancelArmed) return { action: "exit panel", done: "cancel" };
		return { action: "arm cancel", nextFocus: "list" };
	}

	if (state.focus === "actions") {
		if (input === "tab" || input === "backTab") {
			return { action: "back to list", nextFocus: "list" };
		}
		if (input === "left") return { action: "move action left", nextFocus: "actions" };
		if (input === "right") return { action: "move action right", nextFocus: "actions" };
		if (input === "confirm" || input === "space") {
			if (state.action === "apply") {
				return state.canApply
					? { action: "apply", done: "apply" }
					: { action: "reject apply", nextFocus: "actions" };
			}
			if (state.action === "list") return { action: "back to list", nextFocus: "list" };
			return { action: "exit panel", done: "cancel" };
		}
		return { action: "ignored", nextFocus: "actions" };
	}

	if (state.focus === "scope") {
		if (input === "tab" || input === "backTab") {
			return { action: "open actions", nextFocus: "actions" };
		}
		if (input === "up") return { action: "move selection up", nextFocus: "scope" };
		if (input === "down") return { action: "move selection down", nextFocus: "scope" };
		if (input === "left") {
			return state.column === 0
				? { action: "stay Local", nextFocus: "scope" }
				: { action: "choose Local", nextFocus: "scope" };
		}
		if (input === "right") {
			return state.column === 1
				? { action: "stay Global", nextFocus: "scope" }
				: { action: "choose Global", nextFocus: "scope" };
		}
		if (input === "space") {
			return { action: "toggle scope", nextFocus: "scope" };
		}
		if (input === "confirm") return { action: "back to list", nextFocus: "list" };
		return { action: "ignored", nextFocus: "scope" };
	}

	if (input === "tab" || input === "backTab") {
		return { action: "open actions", nextFocus: "actions" };
	}
	if (input === "up") return { action: "move selection up", nextFocus: "list" };
	if (input === "down") return { action: "move selection down", nextFocus: "list" };
	if (input === "confirm") {
		return state.hasSelection
			? { action: "enter scope", nextFocus: "scope" }
			: { action: "report no selection", nextFocus: "list" };
	}
	return { action: "search edit / other input", nextFocus: "list" };
}

function findConceptConflicts() {
	const states: Array<{ focus: Focus; concepts: Concept[] }> = [
		{
			focus: "list",
			concepts: [
				{ label: "cancel", bindings: ["tui.select.cancel"] },
				{ label: "edit scope", bindings: ["tui.select.confirm"] },
				{ label: "move up", bindings: ["tui.select.up"] },
				{ label: "move down", bindings: ["tui.select.down"] },
				{ label: "open actions", bindings: ["tui.input.tab", "app.manageExtensions.backTab"] },
				{
					label: "search editing",
					bindings: [
						"app.manageExtensions.left",
						"app.manageExtensions.right",
						"app.manageExtensions.toggleOrActivate",
					],
				},
			],
		},
		{
			focus: "scope",
			concepts: [
				{ label: "back to list", bindings: ["tui.select.cancel", "tui.select.confirm"] },
				{ label: "open actions", bindings: ["tui.input.tab", "app.manageExtensions.backTab"] },
				{ label: "move up", bindings: ["tui.select.up"] },
				{ label: "move down", bindings: ["tui.select.down"] },
				{ label: "choose Local", bindings: ["app.manageExtensions.left"] },
				{ label: "choose Global", bindings: ["app.manageExtensions.right"] },
				{ label: "toggle scope", bindings: ["app.manageExtensions.toggleOrActivate"] },
			],
		},
		{
			focus: "actions",
			concepts: [
				{
					label: "back to list",
					bindings: ["tui.select.cancel", "tui.input.tab", "app.manageExtensions.backTab"],
				},
				{ label: "move left", bindings: ["app.manageExtensions.left"] },
				{ label: "move right", bindings: ["app.manageExtensions.right"] },
				{ label: "activate action", bindings: ["tui.select.confirm", "app.manageExtensions.toggleOrActivate"] },
			],
		},
	];

	const conflicts: string[] = [];
	for (const { focus, concepts } of states) {
		for (let i = 0; i < concepts.length; i++) {
			for (let j = i + 1; j < concepts.length; j++) {
				const left = concepts[i]!;
				const right = concepts[j]!;
				const overlap = resolve(left.bindings).filter((key) => resolve(right.bindings).includes(key));
				for (const key of overlap) {
					conflicts.push(`${focus}: ${key} => ${left.label} / ${right.label}`);
				}
			}
		}
	}
	return conflicts;
}

const inputs: LogicalInput[] = [
	"confirm",
	"cancel",
	"tab",
	"backTab",
	"left",
	"right",
	"up",
	"down",
	"space",
	"text",
];

const states: SimState[] = [
	{ focus: "list", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: false, column: 0, action: "list" },
	{ focus: "list", searchEmpty: true, cancelArmed: true, hasSelection: true, canApply: false, column: 0, action: "list" },
	{ focus: "list", searchEmpty: false, cancelArmed: false, hasSelection: true, canApply: false, column: 0, action: "list" },
	{ focus: "list", searchEmpty: true, cancelArmed: false, hasSelection: false, canApply: false, column: 0, action: "list" },
	{ focus: "scope", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: false, column: 0, action: "list" },
	{ focus: "scope", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: false, column: 1, action: "list" },
	{ focus: "actions", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: false, column: 0, action: "apply" },
	{ focus: "actions", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: true, column: 0, action: "apply" },
	{ focus: "actions", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: false, column: 0, action: "list" },
	{ focus: "actions", searchEmpty: true, cancelArmed: false, hasSelection: true, canApply: false, column: 0, action: "cancel" },
];

console.log("# manage-extensions model simulation\n");
console.log("## resolved default bindings");
for (const id of [
	"tui.select.cancel",
	"tui.select.confirm",
	"tui.select.up",
	"tui.select.down",
	"tui.input.tab",
	"app.manageExtensions.backTab",
	"app.manageExtensions.left",
	"app.manageExtensions.right",
	"app.manageExtensions.toggleOrActivate",
]) {
	console.log(`- ${id}: ${resolve([id]).join("/") || "<unbound>"}`);
}

console.log("\n## default same-state key conflicts");
const conflicts = findConceptConflicts();
if (conflicts.length === 0) {
	console.log("none\n");
} else {
	for (const conflict of conflicts) console.log(`- ${conflict}`);
	console.log();
}

console.log("## transition table excerpt");
for (const state of states) {
	console.log(
		`\n[state] focus=${state.focus} searchEmpty=${state.searchEmpty} cancelArmed=${state.cancelArmed} hasSelection=${state.hasSelection} canApply=${state.canApply} column=${state.column} action=${state.action}`,
	);
	for (const input of inputs) {
		const result = transition(state, input);
		const outcome = result.done ? `done:${result.done}` : `next:${result.nextFocus}`;
		console.log(`- ${input.padEnd(10)} => ${result.action} [${outcome}]`);
	}
}
