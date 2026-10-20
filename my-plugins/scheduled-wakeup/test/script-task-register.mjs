import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

registerHooks({
	resolve(specifier, context, nextResolve) {
		const sdkRoot = process.env.PI_LOOP_TEST_SDK_ROOT;
		if (
			sdkRoot !== undefined &&
			specifier === "@earendil-works/pi-coding-agent"
		) {
			return nextResolve(
				pathToFileURL(join(sdkRoot, "dist", "index.js")).href,
				context,
			);
		}
		if (sdkRoot !== undefined && specifier === "@earendil-works/pi-tui") {
			return nextResolve(
				pathToFileURL(join(sdkRoot, "..", "pi-tui", "dist", "index.js")).href,
				context,
			);
		}
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (
				error.code === "ERR_MODULE_NOT_FOUND" &&
				specifier.startsWith(".") &&
				specifier.endsWith(".js")
			) {
				return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
			}
			throw error;
		}
	},
});
