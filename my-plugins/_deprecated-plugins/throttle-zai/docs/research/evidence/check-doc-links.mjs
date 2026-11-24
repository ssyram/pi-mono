// Checks local markdown link targets only; this is not a semantic or design review.
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const files = [];
async function collect(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await collect(path);
		else if (entry.name.endsWith(".md")) files.push(path);
	}
}
await collect(root);
const missing = [];
let targets = 0;
for (const file of files) {
	const text = await readFile(file, "utf8");
	for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
		const target = match[1].split("#", 1)[0];
		if (!target || /^(https?:|mailto:)/.test(target)) continue;
		targets++;
		try { await access(resolve(dirname(file), decodeURIComponent(target))); }
		catch { missing.push({ from: relative(root, file), target }); }
	}
}
console.log(JSON.stringify({ markdownFiles: files.length, relativeTargets: targets, missing,
	limitations: ["No anchor, external URL, semantic or implementation correctness check"] }, null, 2));
if (missing.length) process.exitCode = 1;
