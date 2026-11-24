import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

/** The full coding-agent entry cannot be imported under vitest (same constraint as
 * provider-profiles); route the plugin's value import to the real getAgentDir. */
const hostExports = fileURLToPath(new URL("./test/host-exports.ts", import.meta.url));

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: { include: ["test/**/*.test.ts"] },
		resolve: {
			alias: [{ find: /^@earendil-works\/pi-coding-agent$/, replacement: hostExports }],
		},
	}),
);
