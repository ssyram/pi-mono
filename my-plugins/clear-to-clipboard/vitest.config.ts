import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.js";

export default mergeConfig(
	baseConfig,
	defineConfig({
		root: fileURLToPath(new URL(".", import.meta.url)),
		test: { include: ["*.test.ts"] },
	}),
);
