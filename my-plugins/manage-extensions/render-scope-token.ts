import type { Theme } from "@mariozechner/pi-coding-agent";

export function renderScopeToken(
	theme: Theme,
	label: "L" | "G",
	enabled: boolean,
	active: boolean,
	changed: boolean,
): string {
	const box = enabled ? "[✓]" : "[ ]";
	// L = warning (orange), G = success (green), active = accent (bright)
	const scopeColor = label === "L" ? ("warning" as const) : ("success" as const);
	const baseColor = active ? "accent" : enabled ? scopeColor : "dim";
	const labelColor = active ? "accent" : scopeColor;
	const labelText = theme.bold(theme.fg(labelColor, label));
	let boxText = theme.fg(baseColor, box);
	if (active) boxText = theme.bold(boxText);
	const changedMark = changed ? theme.fg("warning", "*") : theme.fg("muted", "·");
	return `${labelText}${boxText}${changedMark}`;
}
