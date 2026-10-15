import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mySettings, { createMySettingsClient } from "../../my-settings/index.ts";
import register from "./extension.js";
import { GLM_TEAMS_SETTING } from "./glm-team-settings.js";
import type { PiExtensionAPI } from "./pi-extension-contract.js";
import { executeUsageQuery } from "./usage-query.js";

export default async function bootstrap(pi: ExtensionAPI & PiExtensionAPI): Promise<void> {
	await mySettings(pi);
	register(pi, (context) => {
		const settings = createMySettingsClient(pi.events, {
			session: context.sessionManager,
			sessionId: context.sessionManager.getSessionId(),
		});
		return (selection, route, registry, signal) =>
			executeUsageQuery(selection, route, registry, signal, () =>
				settings.query({ scope: "global", defaults: { [GLM_TEAMS_SETTING]: [] } }),
			);
	});
}
