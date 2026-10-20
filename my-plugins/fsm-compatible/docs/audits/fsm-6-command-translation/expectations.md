# Contract Expectations — fsm-6-command-translation

事前源：architecture P10、Q.I-2（mandatory）；subplans/fsm-6-command-translation.md。本单元尚无生产代码，不倒填实施位置。

## 1. 契约源

pi 1.0.3 公开 registerCommand（name/description/handler(args,ctx)）与 ExtensionCommandContextActions（newSession/fork/navigateTree/switchSession/reload/waitForIdle）；ctx.sessionManager 树查询、getContextUsage、shutdown。判断基线：OC 语义命令在官方 Pi 真实可用，不伪造。

## 2. 字段/Schema

命令别名固定五项+/fsm-commands：new/undo/redo/usage/exit。参数：undo/redo 无参数；new 可忽略尾参；exit 无参。prevLeaf 状态为会话内单步 leafId 或 null。

## 3. 枚举

实现集：new/undo/redo/usage/exit/fsm-commands。未实现集（显式报告）：share/models 等公开 API 无法真实支撑者，含原因与 Pi 原生指向。无第三态（不注册假命令）。

## 4. 流程

P1 registerCommandAliases→逐项 handler→真实公开 API→真实副作用/数据。
P2 undo：waitForIdle→leaf→entry.parentId→（null→notify | 记 prevLeaf→navigateTree）。
P3 redo：有 prevLeaf 且有效→navigateTree→清记录；否则 notify。
P4 new/exit：waitForIdle→newSession（cancelled 透传）/shutdown。

源码流程保留 Step Pn 注释。

## 5. 行为

- 每个已注册命令都有真实行为；空实现/装饰注册禁止。
- cancelled/失败如实通知，不吞错不伪装成功。
- 无法映射命令显式未实现+原因+原生指向；不遮蔽 Pi 原生命令。
- prevLeaf 会话归属，newSession 重置；redo 单步不可重放。
- /usage 仅渲染 getContextUsage 真实字段；无数据明示。

## 6. 时序/状态

undo 先等待 idle 再读树；redo 校验记录条目仍存在；状态随会话切换重置。命令处理异步完成（handler await）。

## 7. 不变量/性质

任意树上：undo 后 leaf=原leaf.parent（可断言）；redo 恰恢复 undo 前位置一次；连续两次 redo 第二次必须拒绝；new 后 prevLeaf=null。命令集注册恰一次。

## 8. 资源/界限

命令处理有界（无网络/无长循环）；无新增性能 SLO；无真实模型/网络测试要求。

## 9. 安全/副作用

仅 my-plugins；副作用限公开 API 真实行为（会话树/进程退出）；无秘密；不修改 Pi 原生命令表。

## 10. 一致性/退出

设计先按原 workflow 六项标准确认；实现按本表+明确 diff 独立对照一次；fsm-1~5 结论不重开。通过后 P10 结算；真实模型 E2E/SA 烟雾须账户/预算授权，属运行验证非本单元。
