# Contract Expectations — fsm-7-fleet-widget

事前源：subplans/fsm-7-fleet-widget.md（§1–9 全部裁决）；pi 1.3.0 dist API 核对表（§7/§9.1）。本单元尚无生产代码，不倒填实施位置。

## 1. 契约源

pi 1.3.0 实测公开面：`setWidget(key,factory,{placement})`、`onTerminalInput`、`getEditorText`、`custom<T>`（overlay/top-center/百分比）、`input` 事件（handled/transform）、`emitInput` transform 链+handled 短路、命令分发→input→skill 展开顺序、`TuiBase extends Container`（public children/terminal）、`Component.render(width)` 高度测量、`MAX_WIDGET_LINES=10` 仅限 string[] 工厂组件无上限。pi-tui 1.3.0：Markdown/ScrollView/Container/Text/matchesKey/Key/truncateToWidth/visibleWidth/Theme。内部契约：NativeChildRegistry（rows/parentSessionId）、coordinator 事件回调、child session.jsonl message.usage。

## 2. 字段/Schema

config 新增 `fleetWidgetPlacement: "aboveEditor"|"belowEditor"|"off"`（缺省 belowEditor；off 不注册）。`FleetNode{key,name,shortId,depth,children,record?}`、`FleetFlatRow{node,hasChildren,expanded}`、`FleetLine{kind:"overflow-above"|"overflow-below"|"entry",…}`、`ChildStats{totalTokens,ctxPercent,firstTs,lastTs}`。NativeRuntime 增 `fleet(): {list(),subscribe()}`。

## 3. 枚举

placement 三值；FleetLine kind 三值；终态标记 ✓done/✗failed/✗crashed/⟳recovered（源自 record.lifecycle/outcome 映射，穷举映射表须覆盖 coordinator 全部 lifecycle 值，未知值显示 `?`）。

## 4. 流程

P1 tick（500ms）：registry→buildFleetTree→flattenVisible→windowRows→渲染（缓存 key=树形+选中+窗口+stats 摘要）。
P2 激活：onTerminalInput（编辑器有焦点且 getEditorText()===""）→↓/←/j 激活；↑↓ 移动（逼边滚动）；→ 展开；← 收起；Enter 开 viewer；Esc（仍空编辑器）失活。
P3 viewer：custom overlay top-center/100% 宽；行数=editorTopRow()（null→总行 60% 回退）；首屏 tail≤500 条；存活期增量+事件订阅；done() 释放。
P4 输入重定向：viewer 激活 → input handler → agent_send(viewer 目标, 原文字面) → handled；viewer 未激活 → continue 不改行为。
P5 注册：owned-runtime hasUI 段，资源逆序释放；off/无 UI 零注册。

源码流程保留 Step Pn 注释。

## 5. 行为

- 命令不可拦（早于 input 分发）照常对 Main 执行；`/skill:name` 字面透传不展开（拦截先于展开）；未注册 /xxx 字面透传。
- agent_send 失败：viewer 头部/通知报错， Main 不起 run，不伪造送达。
- Esc 语义：仅空编辑器消费=关 viewer/失活；非空透传编辑器。选 Main 行=退出 viewer。
- 行切换实时重定向 viewer 目标（重读文件+重订阅）。
- 渲染列宽固定右对齐、truncateToWidth 保宽（含 CJK）；身份色 FNV hash 跨刷新稳定。
- 无 child 时仅 Main 单行，不可激活导航。

## 6. 时序/状态

tick 与事件订阅均幂等重入；stats offset 只前进；viewer 打开期间 child 消失→标终态停增量；会话关闭逆序注销（widget/viewer/订阅/tick timer 全清）。激活态在编辑器失焦时自动失活（pi-subagents 同款判据）。

## 7. 不变量/性质（property-based）

- I1 窗口：任意 (树,展开集,top,selected)：总渲染行 ≤7；无上(下)溢出指示 ⟺ 恰多得一条目；指示计数=隐藏数；selected 恒在可见条目内。
- I2 滚动单调：selected 移动导致的 top 变化每次至多 1。
- I3 Σcost.total 对追加条目单调不减；ctxPercent∈[0,100]∪{null}；损坏行不改变既有统计。
- I4 flatten 防环：任意含环输入有限步终止（访问集）。
- I5 输入重定向仅在 viewer 激活时改变管线行为；未激活路径与无插件时逐字节一致。
- I6 资源：open/close 配对——close 后无残留 timer/订阅/widget key（重入 setWidget(undefined) 幂等）。

## 8. 性能/界限

tick ≤500ms 且单 tick 文件读仅增量字节；首屏 viewer tail ≤500 条；渲染缓存命中时不重排 Markdown。无新 SLO 断言（UI 主观流畅即可）。

## 9. 安全/副作用

仅 my-plugins；文件读限于 coordinator 登记的 child sessionFile（无任意路径）；无写入无网络；不触碰其他扩展 widget key；结构访问 tui.children/terminal 只读不 mutate。

## 10. 一致性/退出

设计已 owner 逐项裁决（belowEditor/Esc/输入路由/tmux 否决/贴沿实测）；实现后路径 A（本表机械化+单测+组件测）+ tmux 实测渲染/交互截图级验证；路径 B subagent 独立审未获授权，留待 owner 决定。fsm-1~6 结论不重开；真实模型行为不在本单元。
