# fsm-compatible：用户 Q 与共同前提

## Q.I：用户确定的方向

来源：本次会话初始委托、后续纠正及最新明确裁决：“关键就是从原理上 == OC-level 的 FSM 完全兼容。核心是先 FSM 功能支持，后面增加命令翻译支持（这个基本 mandatory），最后是常用工具支持（这个 optional）。”

1. **Q.I-1 根目标**：最终交付可运行的官方 Pi 插件，从原理上达到 haokun-code OC-level 的 FSM 完全兼容；不是只接 MCP、仅根会话可用、演示或只有成功路径的近似实现。
2. **Q.I-2 必需先后**：先完成 FSM 核心功能支持，再增加常用 Pi 插件命令到 OC/FSM 格式的翻译。命令翻译是必做项，排在核心之后，不被可选工具替代。
3. **Q.I-4 子代理核心准入**：锁定可派遣 subagent 的范围；能运行的 subagent 必须同时加载 `fsm-compatible` 及本运行域规定的其它必载扩展。该约束覆盖根、子、嵌套、恢复和所有派发入口，属于 FSM 核心兼容，不是 optional 工具扩展。名单以明确配置确定，不能把所有发现的 agent 自动纳入，不能让模型自行扩大范围。
4. **Q.I-3 可选扩展**：常用 OC 工具支持排在最后，属于 optional；`AskUserQuestion` 是该类工具的已知例子。未实现这些工具不能被偷偷改写为核心失败，反之也不能宣称已经支持它们。

既有边界继续有效：
1. 所有开发与工作产物限于 `my-plugins/`。Pi 官方源码、`third-party-plugins/`、use-fsm 和 haokun-code 只作参考，不能修改它们来换取适配成功。
3. 用户已在最新消息确认继续方向，授权按 `/qpdi` 和 `/workflow` 推进。按阶段完成架构、细化及逐模块实现，不重问已接受的路线；新产出的阶段合同仍按 workflow 确认，不把 proceed 当未知设计的预先验收。
4. 功能优先，GUI 延后。主子 Stop、Watcher、FSM 状态允许的人类暂停/恢复等核心交互合同不能删除；但这不把 optional 的 AskUserQuestion 工具实现重新升格为 mandatory。
5. 不看旧 `steering-flow`，不以它作为迁移基础。
6. 用已有 Working Stack 二进制维护可接续的目的、依据、未完成责任和用户保留的设计决定。

## Q.A：认知前提及来源

用户已接受基于源码可实现性结论继续推进；这不等于已运行验收，也不表示逐条认可所有源码描述。以下为 AI 已取得的源证前提，保留具体版本和适用范围，不当作用户逐条自述：

- use-fsm 源码 HEAD `eed94316`；Cargo 产品版本 `0.11.0`，wire contract 和 skill schema 均为 2。已见工作树存在未跟踪材料，以下结论绑定所读取的当前文件，不把 HEAD 当作全树内容校验。
- haokun-code HEAD `a4293ca229`；工作树有 `bun.lock` 修改及未跟踪文件。本轮比较的是当前源码，不声称完成所有历史改革的 commit 审计。
- 本机安装的 `@earendil-works/pi-coding-agent` 版本为 `1.0.3`；其发布目录类型与文档提供 `agent_before_settle`、`agent_settled`、工具事件及 SDK 会话。仓库参考源码版本为 `1.0.0`，不能拿本地参考源码代替最终安装版本的运行证据。
- 当前参考 pi-subagents 包版本 `0.74.0`、HEAD `63ac9c2a`，父仓库显示该目录有修改。公开 API 的存在只支持候选接入点，不证明任意同版本安装包均具备完全相同的能力。
- FSM 当前后端只接受 `claude` 和 `opencode`，并直接使用 OpenCode HTTP 协议完成 Review/Stop/Watcher 和 Evidence。来源见调研报告。

## Q.E：当前经验边界

用户判断 FSM 对 subagent 挑剔，因此要求评估重实现与绑定第三方插件；这不是“必须重写”的裁决。本轮尚无新插件运行经验，不编造成功样本。

旧 `claude-fsm-compat` 的 README 明确声明 SubagentStop 不支持、Stop 非等价，且绑定旧 CC 基准；这是排除其作为当前完整适配基础的具体依据，不推广为“所有 CC 路线都不可行”。

## 材料归属

- 源码调研及已接受的路线依据：`research/fsm-compatible-research.md`、`research/runtime-source-conclusions.md`。
- 已进入细化的架构合同：`design/fsm-compatibility/architecture.md`；函数合同：`design/fsm-compatibility/detailed-design.md`。从本层 Q 分配设计义务，不自行降低 Q。
- 首个实施单元：`design/fsm-compatibility/subplans/fsm-1-admission-binding.md`；事前对照：`audits/fsm-1-admission-binding/expectations.md`。
- 唯一 WS：`../working-stack.yaml`，根目标仍是插件交付，方案交付不得关闭根责任。
- 此文保存目的与共同前提；架构取舍、运行风险和未闭合条件属于设计，不反写为降低目标的 Q.I。
