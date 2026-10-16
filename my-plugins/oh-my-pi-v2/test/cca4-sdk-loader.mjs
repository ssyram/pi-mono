import { registerHooks } from "node:module";

const settingsExtension = new URL("../../my-settings/extension.ts", import.meta.url).href;
const settingGet = new URL("../../my-settings/setting-command-get.ts", import.meta.url).href;
const settingsSdk = new URL("./task-settings-sdk.ts", import.meta.url).href;
const persistenceTest = new URL("../../scheduled-wakeup/test/session-persistence.test.ts", import.meta.url).href;
const sessionManager = new URL("../../../packages/coding-agent/src/core/session-manager.ts", import.meta.url).href;

// Use real SDK exports without importing the unrelated model-provider catalog.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-coding-agent") {
			if (context.parentURL === settingsExtension || context.parentURL === settingGet)
				return { url: settingsSdk, shortCircuit: true };
			if (context.parentURL === persistenceTest) return { url: sessionManager, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
