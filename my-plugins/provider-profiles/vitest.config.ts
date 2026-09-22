import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

const sourceProviderDirectory = fileURLToPath(new URL("../../packages/ai/src/providers", import.meta.url));
const officialCatalogDirectory = "/tmp/pp-catalog-0861/package/dist/providers/data";

/** The full coding-agent entry cannot be imported under vitest (its src tree
 * references unaliased legacy package names). Route the plugin's value import
 * to the real getAgentDir from the workspace source — same function, not a
 * stub. Production resolves the real package via VIRTUAL_MODULES. */
const hostExports = fileURLToPath(new URL("./test/host-exports.ts", import.meta.url));

export default mergeConfig(
	baseConfig,
	defineConfig({
		plugins: [
			{
				name: "provider-profiles-official-catalog-data",
				enforce: "pre",
				resolveId(source, importer) {
					if (!importer || !source.startsWith("./data/") || !source.endsWith(".json")) return;
					const importerDirectory = dirname(importer.split("?", 1)[0]);
					if (importerDirectory !== sourceProviderDirectory) return;
					const sourcePath = resolve(importerDirectory, source);
					if (existsSync(sourcePath)) return;
					const officialPath = resolve(officialCatalogDirectory, source.slice("./data/".length));
					return existsSync(officialPath) ? officialPath : undefined;
				},
			},
		],
		test: {
			include: ["test/**/*.test.ts"],
		},
		resolve: {
			alias: [{ find: /^@earendil-works\/pi-coding-agent$/, replacement: hostExports }],
		},
	}),
);
