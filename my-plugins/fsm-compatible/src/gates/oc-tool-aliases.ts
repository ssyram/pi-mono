import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFileToolAliases } from "./file-tool-aliases.ts";
import { registerSearchToolAliases } from "./search-tool-aliases.ts";
import { registerShellToolAlias } from "./shell-tool-alias.ts";

/**
 * OC/CC tool-name and parameter aliases so model tool calls emitted in any
 * convention (CC `Write(file_path)`, OC `write(filePath)`, Pi `write(path)`)
 * execute against real implementations and pass FSM whitelists.
 */
export function registerOcToolAliases(pi: ExtensionAPI, cwd: string, env?: NodeJS.ProcessEnv): () => void {
	registerFileToolAliases(pi);
	registerSearchToolAliases(pi);
	registerShellToolAlias(pi, cwd, env);
	return () => {
		/* registerTool has no unregister */
	};
}
