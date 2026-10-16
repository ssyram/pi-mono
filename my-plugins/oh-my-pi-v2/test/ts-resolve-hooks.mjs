import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// npm 包名 → 仓库目录名：优先同名目录，否则去 "pi-" 前缀（pi-tui→tui、pi-coding-agent→coding-agent…）。
function pkgDir(name) {
	if (name === "pi-agent-core") return "agent";
	if (existsSync(join(repoRoot, "packages", name))) return name;
	if (name.startsWith("pi-") && existsSync(join(repoRoot, "packages", name.slice(3)))) return name.slice(3);
	return undefined;
}

function pinUrl(segments) {
	const path = join(repoRoot, ...segments);
	return existsSync(path) ? pathToFileURL(path).href : undefined;
}

export async function resolve(specifier, context, nextResolve) {
	const spec = String(specifier);
	const exact = /^@earendil-works\/([a-z-]+)$/.exec(spec);
	if (exact) {
		const dir = pkgDir(exact[1]);
		const pinned = dir ? pinUrl(["packages", dir, "src", "index.ts"]) : undefined;
		if (pinned) return nextResolve(pinned, context);
	}
	const sub = /^@earendil-works\/([a-z-]+)\/(.+)$/.exec(spec);
	if (sub) {
		const dir = pkgDir(sub[1]);
		if (dir) {
			for (const candidate of [["packages", dir, "src", `${sub[2]}.ts`], ["packages", dir, "src", sub[2], "index.ts"]]) {
				const pinned = pinUrl(candidate);
				if (pinned) return nextResolve(pinned, context);
			}
		}
	}
	try {
		return await nextResolve(specifier, context);
	} catch (error) {
		if (spec.endsWith(".js") && !spec.startsWith("node:")) {
			try {
				const rewritten = (spec.startsWith("./") || spec.startsWith("../")) && context.parentURL
					? new URL(spec.slice(0, -3) + ".ts", context.parentURL).href
					: spec.slice(0, -3) + ".ts";
				return await nextResolve(rewritten, context);
			} catch {
				/* fall through */
			}
		}
		throw error;
	}
}
