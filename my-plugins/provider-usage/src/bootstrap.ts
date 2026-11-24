import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mySettings, { createMySettingsClient } from "../../my-settings/index.ts";
import register from "./extension.ts";
import { GLM_TEAMS_SETTING } from "./glm-team-settings.ts";
import type { PiExtensionAPI } from "./pi-extension-contract.ts";
import { executeUsageQuery } from "./usage-query.ts";

export default async function bootstrap(pi: ExtensionAPI & PiExtensionAPI): Promise<void> {
	await mySettings(pi);
	register(pi, (context) => {
		const settings = createMySettingsClient(pi.events, {
			session: context.sessionManager,
			sessionId: context.sessionManager.getSessionId(),
		});
		return (selection, route, registry, signal, readEntries) =>
			executeUsageQuery(
				selection,
				route,
				registry,
				signal,
				() => settings.query({ scope: "global", defaults: { [GLM_TEAMS_SETTING]: [] } }),
				undefined,
				readEntries,
			);
	});
}
