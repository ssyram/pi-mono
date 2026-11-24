import { readFileSync } from "node:fs";

// Compares package-lock.json against node_modules/.package-lock.json (the snapshot npm
// writes on install) so a stale checkout fails fast with an actionable message instead
// of misleading tsc module/type errors deep in the check chain.
function loadJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

const lock = loadJson("package-lock.json");
const snapshot = loadJson("node_modules/.package-lock.json");
const failures = [];

if (lock === undefined) {
	console.error("package-lock.json is missing or unreadable.");
	process.exit(1);
}

if (snapshot === undefined) {
	console.error("node_modules is missing or has no npm snapshot.");
	console.error("Run: npm install --ignore-scripts");
	console.error("(still failing: rm -rf node_modules packages/*/node_modules && npm install --ignore-scripts)");
	process.exit(1);
}

const lockPackages = lock.packages ?? {};
const snapshotPackages = snapshot.packages ?? {};

for (const [path, entry] of Object.entries(lockPackages)) {
	if (path === "" || !entry.version) continue;
	const installed = snapshotPackages[path];
	if (installed === undefined) {
		// Platform-specific optionals are legitimately absent on this machine.
		if (entry.optional) continue;
		failures.push(`${path}@${entry.version} is missing from node_modules`);
		continue;
	}
	if (installed.version !== entry.version) {
		failures.push(`${path}: node_modules has ${installed.version}, lockfile has ${entry.version}`);
	}
}

for (const path of Object.keys(snapshotPackages)) {
	if (path === "") continue;
	if (lockPackages[path] === undefined) failures.push(`${path} is installed but absent from the lockfile (leftover)`);
}

if (failures.length > 0) {
	console.error("node_modules is out of sync with package-lock.json.");
	console.error("Run: npm install --ignore-scripts");
	console.error("(still failing: rm -rf node_modules packages/*/node_modules && npm install --ignore-scripts)");
	for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
	if (failures.length > 20) console.error(`  … and ${failures.length - 20} more`);
	process.exit(1);
}
