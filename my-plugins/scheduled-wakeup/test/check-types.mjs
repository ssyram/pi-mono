import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(plugin, "../..");
const sdk = process.env.PI_LOOP_TEST_SDK_ROOT;
if (!sdk)
	throw new Error(
		"Set PI_LOOP_TEST_SDK_ROOT to the installed official Pi package.",
	);
const temporary = mkdtempSync(join(tmpdir(), "loop-sdk-types-"));
try {
	const config = join(temporary, "tsconfig.json");
	writeFileSync(
		config,
		JSON.stringify({
			extends: join(plugin, "tsconfig.json"),
			compilerOptions: {
				typeRoots: [join(root, "node_modules/@types")],
				paths: {
					"@earendil-works/pi-coding-agent": [
						join(resolve(sdk), "dist/index.d.ts"),
					],
					"@earendil-works/pi-tui": [
						join(resolve(sdk), "../pi-tui/dist/index.d.ts"),
					],
				},
			},
		}),
	);
	const result = spawnSync(
		process.execPath,
		[join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", config],
		{ stdio: "inherit" },
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
