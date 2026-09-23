import { isAbsolute, relative, resolve, sep } from "node:path";
import { sanitizeDisplayText } from "./sanitize-display-text.js";

export function formatFooterPath(cwd: string, home: string | undefined, branch: string | null, sessionName: string | undefined): string {
	let path = cwd;
	if (home) {
		const relativeToHome = relative(resolve(home), resolve(cwd));
		const insideHome =
			relativeToHome === "" ||
			(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
		if (insideHome) path = relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
	}
	if (branch) path += ` (${sanitizeDisplayText(branch)})`;
	if (sessionName) path += ` • ${sanitizeDisplayText(sessionName)}`;
	return sanitizeDisplayText(path);
}
