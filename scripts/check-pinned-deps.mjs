import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
const exactVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const packageJsonFiles = [];

function collectPackageJsonFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (ignoredDirectories.has(entry.name)) continue;
			const subdir = join(directory, entry.name);
			// Skip embedded git repos (submodules, third-party repos)
			if (existsSync(join(subdir, ".git"))) continue;
			collectPackageJsonFiles(subdir);
			continue;
		}

		if (entry.isFile() && entry.name === "package.json") {
			packageJsonFiles.push(join(directory, entry.name));
		}
	}
}

function isNonRegistrySpecifier(specifier) {
	return /^(?:workspace:|file:|link:|portal:|git\+|github:|git:|https?:|ssh:|git:\/\/)/.test(specifier);
}

function getVersionSpecifier(specifier) {
	if (!specifier.startsWith("npm:")) return specifier;
	const aliasTarget = specifier.slice("npm:".length);
	const versionSeparator = aliasTarget.lastIndexOf("@");
	if (versionSeparator <= 0) return specifier;
	return aliasTarget.slice(versionSeparator + 1);
}

const failures = [];

collectPackageJsonFiles(".");

// Gitignored trees (vendored caches, runtime homes) sit outside the pinning policy.
// Filter through git itself so nested .gitignore files and negation rules apply.
// Outside a repository, or if git is unavailable, keep every collected path.
function dropGitIgnored(paths) {
	const result = spawnSync("git", ["check-ignore", "--stdin"], { input: paths.join("\n"), encoding: "utf8" });
	if (result.error || result.status === null || result.status > 1) return paths;
	const ignored = new Set(result.stdout.split("\n").filter(Boolean));
	return paths.filter((path) => !ignored.has(path));
}

for (const file of dropGitIgnored(packageJsonFiles).sort()) {
	const packageJson = JSON.parse(readFileSync(file, "utf8"));

	for (const section of dependencySections) {
		const dependencies = packageJson[section];
		if (!dependencies) continue;

		for (const [name, specifier] of Object.entries(dependencies)) {
			if (isNonRegistrySpecifier(specifier)) continue;
			if (exactVersionPattern.test(getVersionSpecifier(specifier))) continue;
			failures.push(`${file}: ${section}.${name} must be pinned, found ${specifier}`);
		}
	}
}

if (failures.length > 0) {
	console.error("Direct registry dependencies must use exact versions:");
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
