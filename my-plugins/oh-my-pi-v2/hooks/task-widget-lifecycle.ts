import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";

export function registerTaskWidgetLifecycle(
	pi: ExtensionAPI,
	render: (context: ExtensionContext) => void | Promise<void>,
): void {
	const refresh = async (context: ExtensionContext): Promise<void> => {
		try {
			await render(context);
		} catch (error) {
			reportBoulderDiagnostic(
				`[oh-my-pi task] Widget refresh failed: ${describeThrown(error)}`,
			);
		}
	};
	pi.on("session_start", (_event, context) => refresh(context));
	pi.on("session_tree", (_event, context) => refresh(context));
	pi.on("session_shutdown", (_event, context) => {
		try {
			context.ui.setWidget("omp-tasks", undefined);
		} catch (error) {
			reportBoulderDiagnostic(
				`[oh-my-pi task] Widget shutdown cleanup failed: ${describeThrown(error)}`,
			);
		}
	});
}
