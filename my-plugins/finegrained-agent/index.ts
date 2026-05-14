/**
 * finegrained-agent — Extension entry point.
 *
 * Registers /finegrained-agent command that drives a rigid multi-phase
 * consistency analysis pipeline with parallel sub-agent sessions.
 */

import { getModel } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runPipeline } from "./src/pipeline.js";

const NANO_PROVIDER = "openai";
const NANO_MODEL_ID = "gpt-5.4-nano";

export default async function finegrainedAgent(pi: ExtensionAPI) {
	pi.registerCommand("finegrained-agent", {
		description: "受控细粒度一致性检查管道 (多阶段、并行 sub-agent)",
		handler: async (args, ctx) => {
			const target = args.trim();
			if (!target) {
				ctx.ui.notify("用法: /finegrained-agent <文件路径|目录|主题>", "error");
				return;
			}

			// Resolve models
			const mainModel = ctx.model;
			if (!mainModel) {
				ctx.ui.notify("无法确定当前模型", "error");
				return;
			}
			const nanoModel = getModel(NANO_PROVIDER, NANO_MODEL_ID);
			if (!nanoModel) {
				ctx.ui.notify(`无法找到 nano 模型: ${NANO_PROVIDER}/${NANO_MODEL_ID}`, "error");
				return;
			}

			ctx.ui.notify(`启动 finegrained-agent 管道: ${target}`, "info");

			try {
				const result = await runPipeline({
					target,
					cwd: ctx.cwd,
					mainModel,
					nanoModel,
					modelRegistry: ctx.modelRegistry,
					signal: ctx.signal,
					onProgress: (message) => {
						ctx.ui.notify(message, "info");
					},
				});

				const summary = [
					`finegrained-agent 完成 (run: ${result.runId})`,
					`报告: ${result.reportPath}`,
					`命题: ${result.summary.totalPropositions}`,
					`矛盾: ${result.summary.totalContradictions}`,
					`遗漏: ${result.summary.totalOmissions}`,
					`矩阵空洞: ${result.summary.totalMatrixGaps}`,
					`高严重度: ${result.summary.highSeverityCount}`,
				].join("\n");

				ctx.ui.notify(summary, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`finegrained-agent 失败: ${message}`, "error");
			}
		},
	});
}
