import { spawnSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, ".build", "nico");
const tsc = join(root, "node_modules", "typescript", "lib", "tsc.js");

rmSync(outDir, { recursive: true, force: true });
const result = spawnSync(process.execPath, [tsc, "-p", join(root, "scripts", "tsconfig.nico-bridge.json")], {
	cwd: root,
	stdio: "inherit",
});
if (result.status !== 0) process.exitCode = result.status ?? 1;
else if (!existsSync(join(outDir, "runs", "shared", "child-session.js"))) {
	console.error("nico bridge build produced no child-session.js");
	process.exitCode = 1;
} else {
	console.log(`Built nico child-session bridge: ${outDir}`);
}
