import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function registerShellToolAlias(pi: ExtensionAPI, cwd = process.cwd(), env?: NodeJS.ProcessEnv): void {
	const tool = createBashToolDefinition(cwd, { spawnHook: (context) => ({ ...context,
		env: { ...context.env, ...env } }) });
	pi.registerTool(tool);
	pi.registerTool({ ...tool, name: "Bash", label: "Bash", description: "Execute a shell command; timeout is milliseconds",
		parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()) }),
		async execute(id, input, signal, update, ctx) {
			return tool.execute(id, { command: input.command,
				...(input.timeout === undefined ? {} : { timeout: input.timeout / 1000 }) }, signal, update, ctx);
		},
	});
}
