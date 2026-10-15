import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			specifier === "@earendil-works/pi-coding-agent" &&
			/\/my-plugins\/my-settings\/[^/]+\.ts$/.test(context.parentURL ?? "")
		) {
			return { url: new URL("./sdk-runtime.ts", import.meta.url).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
