import { registerHooks } from "node:module";

const nativeApi = new URL(
	"./prepare-compaction-request-native-api.mjs",
	import.meta.url,
).href;
const forbiddenProvider = new URL(
	"./prepare-compaction-request-provider-guard.ts",
	import.meta.url,
).href;
const compactionSource = new URL(
	"../../../packages/coding-agent/src/core/compaction/compaction.ts",
	import.meta.url,
).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-coding-agent") {
			return { url: nativeApi, shortCircuit: true };
		}
		if (
			specifier === "@earendil-works/pi-ai/compat" &&
			context.parentURL === compactionSource
		) {
			return { url: forbiddenProvider, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
