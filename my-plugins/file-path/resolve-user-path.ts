import { homedir } from "node:os";
import { resolve } from "node:path";

export function resolveUserPath(
	path: string,
	cwd: string,
	home: string = homedir(),
): string {
	if (path === "~") return resolve(home);
	if (path.startsWith("~/")) return resolve(home, `.${path.slice(1)}`);
	return resolve(cwd, path);
}
