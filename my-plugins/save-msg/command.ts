import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { groupIntoTurns, serializeTurns } from "./turns.js";
import { showMessagePicker } from "./message-list.js";
import { outputResult } from "./output.js";
import { parseArgs } from "./parse-args.js";
import { type ArgumentCandidate, createCommandArgumentProvider } from "./tab-complete.js";

/** Menu shown by Tab after `/save-msg `. Mirrors the options parseArgs accepts. */
const OPTION_CANDIDATES: ArgumentCandidate[] = [
	{ value: "--pick", description: "交互式选择消息" },
	{ value: "--with-tools", description: "包含工具调用内容" },
	{ value: "--raw", description: "输出为 JSON" },
	{ value: "--append", description: "追加到目标路径" },
	{ value: "--no-header", description: "不输出角色/时间标题" },
	{ value: "--help", description: "显示帮助" },
];

function completeSaveMsgArgument(previousTokens: string[], token: string): ArgumentCandidate[] | null {
	// A token that does not look like an option is a path — leave it to the
	// underlying provider so file completion still works there.
	if (token && !token.startsWith("-")) return null;

	const used = new Set(previousTokens);
	const remaining = OPTION_CANDIDATES.filter((candidate) => !used.has(candidate.value));
	return remaining.length > 0 ? remaining : null;
}

const HELP = `\
/save-msg — 保存会话消息

用法：
  /save-msg <path>                保存最后一条 assistant 回复
  /save-msg --pick [path]         交互式选择消息（面板内 / 搜索, space 选择, a 全选, t 工具, r JSON）
  /save-msg --with-tools <path>   包含工具调用内容
  /save-msg --raw <path>          输出为 JSON
  /save-msg --append <path>       追加到目标路径
  /save-msg --no-header <path>    不输出角色/时间标题
  /save-msg --help, -h            显示此帮助

选项可组合：/save-msg --with-tools --raw output.json

省略路径时复制到剪贴板。
在 /save-msg 后按 Tab 可列出选项菜单。`;

export default function (pi: ExtensionAPI) {
	// Autocomplete wrappers are cleared on /reload, so re-register every session.
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) =>
			createCommandArgumentProvider(current, { command: "save-msg", complete: completeSaveMsgArgument }),
		);
	});

	pi.registerCommand("save-msg", {
		description: "Save the last assistant reply (or picked messages) to a path or clipboard",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify(HELP, "info");
				return;
			}

			const parsed = parseArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}
			const opts = parsed.options;

			if (opts.help) {
				ctx.ui.notify(HELP, "info");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const turns = groupIntoTurns(branch);

			if (opts.pick) {
				await showMessagePicker(turns, opts, ctx);
				return;
			}

			const lastAssistant = [...turns].reverse().find(t => t.role === "assistant");
			if (!lastAssistant) {
				ctx.ui.notify("No assistant message found", "warning");
				return;
			}

			const text = serializeTurns([lastAssistant], opts.raw, opts.withTools, opts.noHeader);
			await outputResult(text, opts.path, opts.append, ctx.cwd, (m, l) => ctx.ui.notify(m, l));
		},
	});
}
