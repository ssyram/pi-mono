import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const parity = process.argv.includes("--parity"), ccv = process.argv.includes("--ccv");
if (parity && ccv) throw new Error("Choose one integration suite");
const ccvInputs = {};
if (ccv) {
	for (const name of ["FSM_COMPATIBLE_TEST_CCV_ROOT", "FSM_COMPATIBLE_TEST_CCV_MOCKER", "FSM_COMPATIBLE_TEST_RUNTIME_ENV"]) {
		if (!process.env[name]) throw new Error(`Set ${name}; CCV integration cannot be silently skipped`);
		await access(process.env[name], constants.R_OK); ccvInputs[name] = resolve(process.env[name]);
	}
	ccvInputs.framework_git_head = execFileSync("git", ["-C", process.env.FSM_COMPATIBLE_TEST_CCV_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	ccvInputs.mocker_sha256 = {};
	for (const name of (await readdir(process.env.FSM_COMPATIBLE_TEST_CCV_MOCKER)).sort()) {
		if (/\.(py|c|md)$/.test(name)) ccvInputs.mocker_sha256[name] = createHash("sha256").update(await readFile(join(process.env.FSM_COMPATIBLE_TEST_CCV_MOCKER, name))).digest("hex");
	}
}
const required = ["FSM_COMPATIBLE_TEST_SERVER", "FSM_COMPATIBLE_TEST_CLIENT", "FSM_COMPATIBLE_TEST_PI", "FSM_COMPATIBLE_TEST_MOCK",
	...(parity ? ["FSM_COMPATIBLE_TEST_OC", "FSM_COMPATIBLE_TEST_OC_PLUGIN", "FSM_COMPATIBLE_TEST_HOOK", "FSM_COMPATIBLE_TEST_OC_MODELS"] : [])];
const binaries = {};
for (const name of required) {
	const path = process.env[name];
	if (!path) throw new Error(`Set ${name}; native integration cannot be silently skipped`);
	await access(path, ["FSM_COMPATIBLE_TEST_PI", "FSM_COMPATIBLE_TEST_OC_PLUGIN", "FSM_COMPATIBLE_TEST_OC_MODELS"].includes(name) ? constants.R_OK : constants.X_OK);
	binaries[name] = { path: resolve(path), sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
}
const files = [];
async function collect(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if ([".tmp", "node_modules", ".runtime", ".git"].includes(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await collect(path);
		else if (entry.isFile()) files.push(path);
	}
}
await collect(join(root, "src")); await collect(join(root, "test")); await collect(join(root, "scripts"));
files.push(join(root, "package.json"), join(root, "package-lock.json"), join(root, "tsconfig.json"));
const hash = createHash("sha256");
for (const path of files.sort()) { hash.update(relative(root, path)); hash.update("\0"); hash.update(await readFile(path)); hash.update("\0"); }
const sourceId = hash.digest("hex");
const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const artifacts = process.env.FSM_COMPATIBLE_TEST_ARTIFACTS ?? join(root, ".runtime", "native-tests", stamp);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const installedPi = JSON.parse(await readFile(join(dirname(process.env.FSM_COMPATIBLE_TEST_PI), "..", "package.json"), "utf8"));
await writeFile(join(artifacts, "manifest.json"), JSON.stringify({ created_at: new Date().toISOString(), source_sha256: sourceId,
	base_git_head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
	kind: ccv ? "ccv-v3-delivery" : parity ? "oc-pi-parity" : "native", ccv_inputs: ccvInputs, node: process.version, platform: process.platform, arch: process.arch, pi_version: installedPi.version,
	...(parity ? { oc_version: execFileSync(process.env.FSM_COMPATIBLE_TEST_OC, ["--version"], { encoding: "utf8" }).trim() } : {}), binaries }, null, 2), { mode: 0o600 });
console.log(`Native source: ${sourceId}\nPrivate artifacts: ${artifacts}`);
const tests = ccv ? ["test/ccv-v3-integration.test.ts", "test/ccv-delivery-integration.test.ts"] : parity ? ["test/native-oc-pi-parity.test.ts"] : ["test/native-child-integration.test.ts", "test/native-child-lifecycle.test.ts",
	"test/native-child-startup.test.ts", "test/native-child-observability.test.ts", "test/native-child-transport-continuation.test.ts"];
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...process.argv.slice(2).filter((arg) => !["--parity", "--ccv"].includes(arg)), ...tests], {
	cwd: root, env: { ...process.env, FSM_COMPATIBLE_TEST_ARTIFACTS: artifacts, FSM_COMPATIBLE_TEST_SOURCE_ID: sourceId }, encoding: "utf8",
	maxBuffer: 32 * 1024 * 1024,
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
await writeFile(join(artifacts, "results.txt"), output, { mode: 0o600 });
process.stdout.write(output);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
