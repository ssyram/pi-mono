import type { Component } from "@earendil-works/pi-tui";

interface ContainerComponent extends Component {
	children: Component[];
	removeChild(component: Component): void;
}

interface ExpandableComponent extends Component {
	setExpanded(expanded: boolean): void;
}

function recordOf(value: unknown): Record<string, unknown> {
	return value as Record<string, unknown>;
}

function isContainerComponent(value: unknown): value is ContainerComponent {
	if (typeof value !== "object" || value === null) return false;
	const record = recordOf(value);
	return (
		Array.isArray(record.children) &&
		typeof record.removeChild === "function" &&
		typeof record.render === "function" &&
		typeof record.invalidate === "function"
	);
}

function isAssistantComponent(component: Component): boolean {
	return typeof recordOf(component).updateContent === "function";
}

function toolCallIdOf(component: Component): string | undefined {
	const record = recordOf(component);
	return typeof record.toolCallId === "string" && typeof record.updateResult === "function"
		? record.toolCallId
		: undefined;
}

function isExpandableComponent(component: Component): component is ExpandableComponent {
	return typeof recordOf(component).setExpanded === "function";
}

export { isAssistantComponent, isContainerComponent, isExpandableComponent, toolCallIdOf };
export type { ContainerComponent };
