import { type Component, MouseRegion, Text } from "@earendil-works/pi-tui";

const expandedKeys = new Set<string>();

export interface ClickExpandTextViews {
	key: string;
	collapsed: () => string;
	expanded: () => string;
}

/**
 * One-line label that flips between two views on left-click.
 * Reads the module-level store on every render, so host rebuilds and stale
 * component instances can never show wrong or missing content, and no
 * callback in here can throw or return null.
 */
export class ClickExpandText implements Component {
	private readonly views: ClickExpandTextViews;

	constructor(views: ClickExpandTextViews) {
		this.views = views;
	}

	render(width: number): string[] {
		try {
			const line = expandedKeys.has(this.views.key) ? this.views.expanded() : this.views.collapsed();
			return new Text(typeof line === "string" ? line : "", 0, 0).render(width);
		} catch {
			return [""];
		}
	}

	invalidate(): void {}
}

/**
 * Wrap a component with a left-click expand toggle for the given key.
 * The handler can never throw (dispatchMouseEvent does not catch handler
 * errors) and only ever returns undefined or { handled: true }.
 */
export function clickExpandable(component: Component, key: string): Component {
	return new MouseRegion(component, (event) => {
		try {
			if (event.type !== "click" || event.button !== "left") return undefined;
			if (expandedKeys.has(key)) expandedKeys.delete(key);
			else expandedKeys.add(key);
			return { handled: true };
		} catch {
			return undefined;
		}
	});
}

/** Test hook: clear all click-expand state. */
export function resetClickExpandState(): void {
	expandedKeys.clear();
}
