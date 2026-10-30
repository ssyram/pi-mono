import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** HC shell.ts parity: aborted/timed-out commands resolve normally with a
 * <shell_metadata> envelope instead of an error status. */
function shellMetadataResult(text: string, meta: string) {
	const body = text
		.replace(/\n\nCommand aborted$/, "")
		.replace(/^Command aborted$/, "")
		.replace(/\n?\n?Command timed out after [0-9.]+ seconds$/, "")
		|| "(no output)";
	const output = `${body}\n\n<shell_metadata>\n${meta}\n</shell_metadata>`;
	// HC durable part carries the killed shell's absent exit code as null.
	return { content: [{ type: "text" as const, text: output }], details: { metadata: { output, exit: null, truncated: false } } };
}

export function registerShellToolAlias(pi: ExtensionAPI, cwd = process.cwd(), env?: NodeJS.ProcessEnv): void {
	const base = createBashToolDefinition(cwd, { spawnHook: (context) => ({ ...context,
		env: { ...context.env, ...env } }) });
	const tool = { ...base,
		async execute(id: string, input: { command: string; timeout?: number; workdir?: string }, signal?: AbortSignal, update?: Parameters<typeof base.execute>[3], ctx?: Parameters<typeof base.execute>[4]) {
			try {
				// HC's wire contract declares timeout in milliseconds and an
				// optional workdir; the host takes seconds and a fixed cwd.
				if (input.timeout !== undefined && !(input.timeout > 0)) {
					return { content: [{ type: "text", text: `The bash tool was called with invalid arguments: SchemaError(Expected a value greater than 0, got ${input.timeout}\n  at ["timeout"]).\nPlease rewrite the input so it satisfies the expected schema.` }], isError: true } as never;
				}
				const quoted = input.workdir ? `'${input.workdir.replaceAll("'", `'\''`)}'` : undefined;
				const command = quoted ? `cd ${quoted} && ${input.command}` : input.command;
				const normalized = input.timeout === undefined ? { command }
					: { command, timeout: input.timeout / 1000 };
				const runDir = process.env.PLOT_RUN;
				const partial = runDir ? `${runDir}/tmp/bash-${id}.partial` : null;
				type Patch = { content?: { type: string; text: string }[] };
				const streamingUpdate = update && partial
					? ((patch: Patch) => {
							const text = (patch?.content ?? []).map((c) => c.text).join("");
							if (text) void import("node:fs/promises").then((fs) => fs.writeFile(partial, text)).catch(() => {});
							return (update as (p: Patch) => void)(patch);
						}) as unknown as Parameters<typeof base.execute>[3]
					: update;
				const raw = await base.execute(id, normalized as never, signal, streamingUpdate, ctx as Parameters<typeof base.execute>[4]) as { content?: { type: string; text?: string }[]; isError?: boolean };
				// HC's bash receipt carries pure stdout; the exit code rides in
				// metadata, never as a suffix line.
				const rawText = (raw.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
				const m = /\n?\nCommand exited with code (\d+)$/.exec(rawText);
				if (m) {
					const exit = Number(m[1]);
					// Non-zero exits are completed results: stdout only, exit
					// code in metadata (no error status, no suffix line).
					const body = rawText.slice(0, m.index) || "(no output)";
					return { content: [{ type: "text", text: body }], details: { metadata: { exit, output: body } } } as never;
				}
				return raw as never;
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

}
