import { createUsageFooter } from "./footer-component.ts";
import type { ControllerContext } from "./controller-contract.ts";
import { UsageController } from "./usage-controller.ts";
import type { UsageModel } from "./usage-contract.ts";

export function createController(context: ControllerContext, initialModel: UsageModel | undefined): UsageController {
	const controller = new UsageController(context);
	context.setFooter((tui, theme, footerData) => {
		const footer = createUsageFooter(tui, theme, footerData, controller);
		controller.attachFooter(footer, () => tui.requestRender());
		return footer;
	});
	controller.requestRefresh(initialModel);
	return controller;
}
