# fsm-6-command-translation：P10 mandatory 常用命令翻译

状态：P10 编码前叶子合同；尚无生产代码。父合同：architecture P10（"常用 Pi 插件命令的 OC/FSM 语义映射，不只换展示名称"）、Q.I-2（mandatory）。核心五单元（fsm-1~5）已 PASS，本单元只增命令别名，不改任何已结算合同。

## 1. 目的与 callee 绑定

OC 语义的常用命令在官方 Pi 中真实可用：每个别名由真实 Pi 公开行为支撑，不伪造语义、不做静默 no-op；无法映射的 OC 命令显式报告不可用并指向 Pi 原生命令。不遮蔽 Pi 原生命令。

callee（一手已核对，pi 1.0.3 types.d.ts）：

- `pi.registerCommand(name, {description, handler(args, ctx)})`（:1194、:1134）。
- 命令上下文动作（ExtensionCommandContextActions :1646）：`newSession()`（cancelled 标志）、`fork(entryId)`、`navigateTree(targetId)`、`switchSession(path)`、`reload()`、`waitForIdle()`。
- 数据：`ctx.sessionManager`（getLeafId/getEntry/getBranch）、`ctx.getContextUsage()`、`ctx.shutdown()`；`ctx.ui.notify`。

## 2. 最小可验证命令集（本单元交付）

| OC 名 | 行为 | 真实支撑 |
|---|---|---|
| /new | 新会话（同 parent 继承可选参数忽略；等待 idle） | ctx.waitForIdle → ctx.newSession()；cancelled 如实通知 |
| /undo | 回退到当前叶子上一条目（无上级则通知不可回退） | leaf=getLeafId → entry=getEntry(leaf) → navigateTree(entry.parentId)；parentId 为 null 时明确提示 |
| /redo | 前进恢复刚被 /undo 离开的分支 | 记录 undo 前的 leafId（session-owned 单步），navigateTree(记录值)；无记录则提示；不伪造多步历史 |
| /usage | 当前上下文用量 | ctx.getContextUsage() 真实字段渲染；无数据则说"暂无" |
| /exit | 退出（不经过 FSM self-check——/exit 与 _fsm_exit 是 daemon 路由，非宿主命令） | ctx.shutdown() |

别名注册表固定于此五项；每项 handler 都消费真实公开 API 并产生真实副作用或真实数据，空实现/装饰性注册禁止。

## 3. 明确不可映射集合（显式报告，不伪装）

OC 常用而 Pi 公开 API 无法真实支撑的命令（/share 网络上传、/models 全量管理等）：不注册同名假命令；在 /fsm-commands 帮助命令中列出"未实现及原因+Pi 原生等价物"。Pi 原生命令不受影响。

## 4. 函数推导要点

- registerCommandAliases(pi)：注册上表五项 + /fsm-commands（列出已实现/未实现与原因）；返回 disposer（逐个注销——registerCommand 无注销 API 时记录并接受进程生命周期内驻留，文档注明）。
- /undo：waitForIdle→读 leaf/entry→null 则 notify→否则记 prevLeaf=navigateTree 前 leaf→navigateTree(parentId)；失败/cancelled 如实通知，不吞错。
- /redo：仅当存在本会话 prevLeaf 且其仍为有效条目→navigateTree(prevLeaf)→清除记录；否则 notify 无可重做。
- /usage：getContextUsage() undefined→"暂无用量数据"；有则输出真实字段。
- 状态（prevLeaf）session-owned，随 newSession 重置。

## 5. 测试计划

fake ctx（waitForIdle/newSession/navigateTree/getContextUsage/shutdown 可脚本化 + 真 SessionManager inMemory 树）：/new 调用与 cancelled 透传；/undo 在多轮树上回到上一条目、根上明确拒绝；/redo 单步恢复且不可重放；/usage 有/无数据两分支；/exit 调 shutdown；/fsm-commands 列出全集与未实现原因；别名不遮蔽（Pi 原生命令表只读断言）。无真实模型/网络。

## 6. 退出

经原 workflow 六项标准设计确认 READY 后编码；实现后直接测试+一次独立合同对照；通过后 P10 结算，剩余仅真实模型 E2E/SA 集成烟雾（须账户/预算授权）与用户验收。命令集合扩展（更多 OC 命令）按同机制增量加表项，不重开本合同。

## 设计确认钉死（run d850ae30 READY 附带澄清）

- navigateTree 在 compaction 期间抛错（非 cancelled）；undo/redo 对其包 try/catch 并以原始消息 notify，该分支为真实可达路径。
- 1.0.3 扩展 API 无命令表查询；按宿主解析规则注册（ResolvedCommand.invocationName 消歧），/fsm-commands 说明别名可能与原生命令共存；"不遮蔽"由宿主消歧机制+本插件不注册与原生命令同实义不同名的竞争项共同保证。
