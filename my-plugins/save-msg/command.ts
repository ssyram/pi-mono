import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { groupIntoTurns, serializeTurns } from "./turns.js";
import { showMessagePicker } from "./message-list.js";
import { outputResult } from "./output.js";
import { parseArgs } from "./parse-args.js";

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

省略路径时复制到剪贴板。`;

export default function (pi: ExtensionAPI) {
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
