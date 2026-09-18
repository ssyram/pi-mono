import { registerHooks } from "node:module";

const handler = new URL("../hooks/custom-compaction.ts", import.meta.url).href;
const completion = new URL(
	"./custom-compaction-runtime-completion.ts",
	import.meta.url,
).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			specifier === "@earendil-works/pi-ai" &&
			context.parentURL === handler
		) {
			return { url: completion, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
