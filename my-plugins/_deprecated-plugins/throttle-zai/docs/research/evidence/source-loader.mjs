// Resolves emitted .js specifiers to existing TypeScript files only inside provider-profiles for this probe.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (specifier.endsWith(".js") && context.parentURL?.includes("/my-plugins/provider-profiles/")) {
				const source = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
				if (existsSync(fileURLToPath(source))) return { url: source.href, shortCircuit: true };
			}
			throw error;
		}
	},
});
