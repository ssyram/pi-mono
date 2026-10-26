import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** HC shell.ts parity: aborted/timed-out commands resolve normally with a
 * <shell_metadata> envelope instead of an error status. */
function shellMetadataResult(text: string, meta: string) {
	const body = text.replace(/\n\nCommand aborted$/, "").replace(/^Command aborted$/, "") || "(no output)";
	const output = `${body}\n\n<shell_metadata>\n${meta}\n</shell_metadata>`;
	// HC durable part carries the killed shell's absent exit code as null.
	return { content: [{ type: "text" as const, text: output }], details: { metadata: { output, exit: null, truncated: false } } };
}

export function registerShellToolAlias(pi: ExtensionAPI, cwd = process.cwd(), env?: NodeJS.ProcessEnv): void {
	const base = createBashToolDefinition(cwd, { spawnHook: (context) => ({ ...context,
		env: { ...context.env, ...env } }) });
	const tool = { ...base,
		async execute(id: string, input: { command: string; timeout?: number }, signal?: AbortSignal, update?: Parameters<typeof base.execute>[3], ctx?: Parameters<typeof base.execute>[4]) {
			try {
				return await base.execute(id, input as never, signal, update, ctx as Parameters<typeof base.execute>[4]);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (/^Command aborted$|\n\nCommand aborted$/.test(message)) return shellMetadataResult(message, "User aborted the command") as never;
				const timeoutMatch = /Command timed out after ([0-9.]+) seconds$/.exec(message);
				if (timeoutMatch) {
					const ms = Math.round(Number(timeoutMatch[1]) * 1000);
					return shellMetadataResult(message,
						`shell tool terminated command after exceeding timeout ${ms} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`) as never;
				}
				throw error;
			}
		} };
	pi.registerTool(tool);
	pi.registerTool({ ...tool, name: "Bash", label: "Bash", description: "Execute a shell command; timeout is milliseconds",
		parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()) }),
		async execute(id, input, signal, update, ctx) {
			return tool.execute(id, { command: input.command,
				...(input.timeout === undefined ? {} : { timeout: input.timeout / 1000 }) }, signal, update, ctx);
		},
	});
}
