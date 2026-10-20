import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** CC `Bash` name alias — Pi's native `bash` covers the lowercase name. */
export function registerShellToolAlias(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "Bash",
		label: "Bash",
		description: "Execute a shell command (CC name)",
		parameters: Type.Object({
			command: Type.String(),
			timeout: Type.Optional(Type.Number()),
		}),
		async execute(_id: string, params: unknown) {
			const input = params as Record<string, unknown>;
			const command = input.command;
			if (typeof command !== "string") throw new Error("Bash requires command");
			const timeout = typeof input.timeout === "number" ? input.timeout : 60_000;
			try {
				const { stdout, stderr } = await execAsync(command, { timeout, maxBuffer: 10 * 1024 * 1024 });
				const out = [stdout, stderr].filter((s) => s.length > 0).join("\n");
				return { content: [{ type: "text" as const, text: out || "(no output)" }] };
			} catch (error) {
				const err = error as { stdout?: string; stderr?: string; message?: string };
				const out = [err.stdout, err.stderr, err.message].filter((s) => typeof s === "string" && s.length > 0).join("\n");
				return { content: [{ type: "text" as const, text: out || "command failed" }] };
			}
		},
	} as never);
}
