import { createUsageFooter } from "./footer-component.js";
import type { ControllerContext } from "./controller-contract.js";
import { UsageController } from "./usage-controller.js";
import type { UsageModel } from "./usage-contract.js";

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
