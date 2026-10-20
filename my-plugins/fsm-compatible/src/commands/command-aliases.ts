import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface UndoState {
	previousLeaf: string | null;
}

const UNIMPLEMENTED: readonly { readonly name: string; readonly reason: string; readonly native: string }[] = [
	{ name: "/share", reason: "公开扩展 API 无会话网络导出/上传能力", native: "使用 Pi 原生会话导出" },
	{ name: "/models", reason: "公开扩展 API 无模型全量管理", native: "使用 Pi 原生模型切换命令" },
];

export const IMPLEMENTED_COMMANDS: readonly string[] = ["/new", "/undo", "/redo", "/usage", "/exit"];

/**
 * Step P1: every alias performs a real public action; unimplementable OC
 * commands are reported explicitly instead of being faked.
 */
export function registerCommandAliases(pi: ExtensionAPI, state: UndoState = { previousLeaf: null }): UndoState {
	pi.registerCommand("new", {
		description: "OC alias: start a new session",
		// Step P4: new session resets undo state; a cancelled creation is reported as-is.
		async handler(_args: string, ctx: ExtensionCommandContext) {
			await ctx.waitForIdle();
			const result = await ctx.newSession();
			if (result.cancelled) ctx.ui.notify("new session cancelled", "warning");
			state.previousLeaf = null;
		},
	});
	pi.registerCommand("undo", {
		description: "OC alias: step back to the previous entry",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			await ctx.waitForIdle();
			// Step P2: leaf -> parent; a null parent is a real refusal, not a no-op.
			const leaf = ctx.sessionManager.getLeafId();
			const entry = leaf === null ? undefined : ctx.sessionManager.getEntry(leaf);
			if (!entry || entry.parentId === null) {
				ctx.ui.notify("nothing to undo: already at the first entry", "warning");
				return;
			}
			const target = entry.parentId;
			const before = leaf;
			try {
				const result = await ctx.navigateTree(target);
				if (result.cancelled) ctx.ui.notify("undo cancelled", "warning");
				else state.previousLeaf = before;
			} catch (error) {
				ctx.ui.notify(`undo failed: ${error instanceof Error ? error.message : "unknown"}`, "error");
			}
		},
	});
	pi.registerCommand("redo", {
		description: "OC alias: redo the single last undo",
		// Step P3: single-step restore of the recorded pre-undo leaf; invalid targets clear the record.
		async handler(_args: string, ctx: ExtensionCommandContext) {
			await ctx.waitForIdle();
			const target = state.previousLeaf;
			if (target === null) {
				ctx.ui.notify("nothing to redo: no undo recorded in this session", "warning");
				return;
			}
			if (!ctx.sessionManager.getEntry(target)) {
				state.previousLeaf = null;
				ctx.ui.notify("redo target no longer exists", "warning");
				return;
			}
			try {
				const result = await ctx.navigateTree(target);
				if (result.cancelled) ctx.ui.notify("redo cancelled", "warning");
				else state.previousLeaf = null;
			} catch (error) {
				ctx.ui.notify(`redo failed: ${error instanceof Error ? error.message : "unknown"}`, "error");
			}
		},
	});
	pi.registerCommand("usage", {
		description: "OC alias: show current context usage",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			const usage = ctx.getContextUsage();
			if (!usage) {
				ctx.ui.notify("usage: no context usage data available", "info");
				return;
			}
			ctx.ui.notify(`usage: ${JSON.stringify(usage)}`, "info");
		},
	});
	pi.registerCommand("exit", {
		description: "OC alias: gracefully shut down pi",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			await ctx.waitForIdle();
			ctx.shutdown();
		},
	});
	pi.registerCommand("fsm-commands", {
		description: "List fsm-compatible command aliases and unsupported OC commands",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			const lines = [
				`implemented: ${IMPLEMENTED_COMMANDS.join(" ")}`,
				...UNIMPLEMENTED.map((item) => `${item.name}: ${item.reason} (${item.native})`),
				"aliases follow the host command resolution; native pi commands are unaffected",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
	return state;
}
