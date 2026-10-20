import type { TUI } from "@earendil-works/pi-tui";

export function createWidgetSpaceProbe(report: (error: unknown) => void) {
	let probing = false;
	let measured = false;
	return {
		isProbing: () => probing,
		markSummary() {
			if (probing) measured = true;
		},
		fits(tui: TUI | undefined, width: number, rows: number): boolean {
			if (
				!tui ||
				tui.mode !== "fullscreen" ||
				width < 1 ||
				tui.children.length !== 7
			)
				return false;
			probing = true;
			measured = false;
			try {
				// Pi 1.2 exposes document followed by six input-dock components.
				// Our summary is forced to one row during measurement; unknown trees never expand.
				const dock = tui.children
					.slice(1)
					.reduce(
						(height, component) =>
							height + component.render(tui.terminal.columns).length,
						0,
					);
				return measured && tui.terminal.rows - dock - 1 >= rows;
			} catch (error) {
				report(error);
				return false;
			} finally {
				probing = false;
			}
		},
	};
}
