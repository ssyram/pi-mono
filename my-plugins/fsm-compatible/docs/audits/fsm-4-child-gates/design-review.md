这两个文件在上一次对话中已全文阅读；三处修订点均可根据上下文进行验证。无需进一步阅读。

## Review — fsm-4-child-gates D4-1/D4-2/D4-3 修订限定确认

范围：仅核对三条修订的闭合与 expectations 同步；不重开其余已核实部分。依据为上轮已直读的修订后 leaf 与 expectations 全文，以及本系列已核实的一手 callee 源。

**D4-1 已闭合（edit 门禁语义）**。leaf §5 edit 行现明确："单个 tool_call 恰好一次 check；多 edits 条目时以完整映射 input `{filePath, edits:[{oldString,newString}…]}` 原样搬运一次提交，denied 整体 block，不逐条拆分门禁"。与 expectations §7 "同一 tool_call 恰好一次 check" 及 §5 同步句一致；既消除了歧义又满足了不变量，且"原样搬运、不改值不造字段"与 §5 normalizer 总则自洽。一手依据（SDK edits 数组，fsm-3 D3-1）下该输入真实可达，现行为唯一确定。

**D4-2 已闭合（runId 来源）**。leaf §2 握手段现写明："started 事件仅确认启动（SubagentDelegationStarted 只含三元组，不携带 runId/SID；runId 从后续 update/terminal 事件取得）→ 握手段完成以 child 侧 initializeChild 登记为准（bootstrap 捕获 + bind + gate + actor-acquire 确认），不依赖 started 携带 SID"。与一手源逐字一致：`SubagentDelegationStarted` 仅三元组（delegation.ts:53-57），runId 随 foreground `:update` 出现（extension-api.md:142）。expectations §4 P1 已同步；我上轮的记录项（实现时直读 required-child-extensions 导出一手源核实"必载不可缩减"）已加入 leaf §2 第四条。

**D4-3 已闭合（lifecycle 穷举）**。leaf §3 与 expectations §3 均补 `unavailable_context→failed（错误保留）`、`invalid_request→failed（属桥自身 bug，需记录诊断）`，并声明"穷举覆盖全部 SA status 枚举"；expectations §7 性质句同步为"（含 unavailable_context/invalid_request）"。对照 delegation.ts:82-94 的 11 个 status：completed→idle；failed/timed_out/tool_budget_exhausted/structured_output_failed/acceptance_failed/unavailable_context→failed；invalid_request→failed；cancelled/interrupted→aborted；duplicate_node 走 §2 原样上报路径（非原 attempt 的 terminal）；unknown→unavailable。全部覆盖，§7 穷举性质可直接断言。

**附带项确认**：leaf §5 与 expectations §4 P4 事件名已统一为 `agent_before_settle`（与官方 SDK 一致）。leaf §7 摘要行仍有 "started/response 关联" 字样，但规范性语义由 §2 定义，属摘要简化，不构成缺口。

### Merge verdict

**READY**。三条修订均为最小闭合且与一手源/expectations 同步一致；无新缺口。可按 leaf §8 测试计划编码。实现后仍需一次独立合同对照；required-child-extensions 一手源核实与 SA 真实集成烟雾按记录留实现对照/安装单元。