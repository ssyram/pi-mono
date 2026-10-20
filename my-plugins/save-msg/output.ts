import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolveUserPath } from "../file-path/resolve-user-path.js";

export async function outputResult(
	text: string,
	filePath: string | undefined,
	append: boolean,
	cwd: string,
	notify: (msg: string, level: "info" | "warning") => void,
) {
	if (filePath) {
		const abs = resolveUserPath(filePath, cwd);
		try {
			await writeFile(abs, text, { flag: append ? "a" : "w" });
			notify(`Saved to ${abs}`, "info");
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			notify(`Failed to save to ${abs}: ${reason}`, "warning");
		}
	} else {
		try {
			execSync("pbcopy", { input: text });
			notify("Copied to clipboard", "info");
		} catch {
			notify("No path given and clipboard unavailable", "warning");
		}
	}
}
