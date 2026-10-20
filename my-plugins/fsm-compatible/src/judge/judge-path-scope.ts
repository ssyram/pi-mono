import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { resolve } from "node:path";
import { RuntimeError } from "../runtime/runtime-error.ts";

/** Resolve a judge tool path against cwd; outside access requires the external_directory grant. */
export function resolveScopedPath(cwd: string, raw: string, allowExternal: boolean): string {
	if (typeof raw !== "string" || !raw) throw new RuntimeError("protocol-invalid");
	const absolute = isAbsolute(raw) ? raw : resolve(cwd, raw);
	const realCwd = realpathSync(cwd);
	if (allowExternal) return absolute;
	const target = existsSync(absolute) ? realpathSync(absolute) : joinNearest(absolute);
	if (target !== realCwd && !target.startsWith(`${realCwd}${sep}`)) throw new RuntimeError("protocol-invalid");
	return target;
}

function joinNearest(absolute: string): string {
	let probe = absolute;
	const missing: string[] = [];
	for (;;) {
		if (existsSync(probe)) return join(realpathSync(probe), ...missing.reverse());
		const parent = dirname(probe);
		missing.push(basename(probe));
		if (parent === probe) return join(realpathSync(probe), ...missing.reverse());
		probe = parent;
	}
}
