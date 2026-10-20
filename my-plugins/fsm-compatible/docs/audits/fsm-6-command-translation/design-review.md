父合同核对完毕。所有 callee 均经一手证实。写设计确认报告(无写工具，以最终回复交付，由 runtime 持久化到绑定输出路径)。

---

# fsm-6-command-translation 编码前设计确认(workflow §4.4 六项标准，P10 mandatory)

结论：**READY——可以开始编码(0 blocking)**;2 项 P2 澄清建议在编码时钉死，不阻塞。
范围纪律：不重审 fsm-1~5;未新增审查目标、provider 测试、GUI 要求。严格只读，直读 4 处 + 3 次定点检索，未执行命令。

## 一、callee 绑定逐条一手核实(pi 1.0.3 dist)

| 叶子引用 | 核实结果 |
|---|---|
| `registerCommand(name,{description,handler})`(:1194) | 存在；handler 签名 `(args: string, ctx: ExtensionCommandContext) => Promise<void>`;**无注销 API**(无返回值、无 unregister)——叶子 §4 “记录并接受进程生命周期内驻留” 的前提成立 |
| `ExtensionCommandContextActions`(:1646) | `waitForIdle/newSession({cancelled})/fork/navigateTree(targetId,{cancelled})/switchSession/reload` 全部在位，返回 `{cancelled}` 与叶子 “cancelled 如实通知” 对应 |
| `ExtensionCommandContext`(:286) | 继承 ExtensionContext,`shutdown()`(:246,"Gracefully shutdown pi and exit")、`getContextUsage(): ContextUsage \| undefined`(:248)在位 |
| `sessionManager.getLeafId/getEntry` | `core/session-manager.d.ts:289-291` 精确签名(`getLeafId(): string\|null`、`getEntry(id)`),js 实现在位；entry 以 `parentId:this.leafId` 链接，/undo 取 `entry.parentId` 可行 |
| navigateTree 真实语义 | `core/agent-session.js:3164-3313`:目标=当前 leaf 时 no-op 返回 `{cancelled:false}`;**compacting 期间抛错**(明确消息)；完成后 emit `session_tree`——undo/redo 有真实宿主行为支撑 |
| 扩展命令可达性 | 用户 "/" 输入派发扩展命令(bundle `_throwIfExtensionCommand`),注册的别名真实可调用 |

## 二、六项标准逐项判定

1. **架构正确性论证就位 — PASS**。每个别名由真实公开行为支撑(/new=newSession、/undo=navigateTree(parentId) 单步、/redo=单步恢复记录的 prevLeaf、/usage=getContextUsage 真实字段、/exit=shutdown),无空实现/装饰注册；不可映射集(/share 等)显式报告+原生指向，与 P10 “不只换展示名称” 和 Q.I-2 mandatory 定位一致;prevLeaf session-owned 单步、明确 “不伪造多步历史”，假设链显式。
2. **细化文档结构就位 — PASS**。目的/callee/固定命令集(真实支撑列)/不可映射集/函数推导/测试计划/退出齐备，与前五个已 PASS 叶子风格一致。
3. **细化完整性六条 — PASS**。推导连续(P2 undo 链含 null parentId 分支;P3 redo 含有效性校验+清除)；分支覆盖(cancelled、无 prevLeaf、条目失效、usage undefined、/fsm-commands 双清单)；退出覆盖(失败/取消如实通知)；callee 契约全部一手证实(上表)；无失控循环；假设链显式。
4. **函数正确性论证就位 — PASS**。registerCommandAliases + 五 handler + prevLeaf 状态转移均有次序与失败出口论证(waitForIdle 先于读树；prevLeaf 于 navigateTree 前记录、redo 成功后清除)。
5. **函数设计满足功能/接口规约 — PASS**。全部签名与 1.0.3 实际声明一致；newSession/navigateTree 的 `{cancelled}` 透传、shutdown void、getContextUsage undefined 分支均有着落；sessionManager 经 ExtensionContext 可达(既有实现已用)。
6. **文档无歧义 — PASS**(附 P2 钉死项)。

## 三、Findings(均为 P2,编码时钉死)

**P2-1(澄清)navigateTree 的抛错分支**：一手源显示 compacting 期间 navigateTree **抛错**而非返回 `{cancelled:true}`(`agent-session.js:3164-3172`)。叶子 §4 “失败/cancelled 如实通知” 已涵盖，但实现须对 undo/redo 的 navigateTree 包 try/catch 并 notify 原始消息；建议在合同或代码注释中把该分支写明(与 FSM compaction 交互是真实可达路径)。

**P2-2(澄清)与 Pi 原生命令的名冲突策略**：叶子承诺 “不遮蔽 Pi 原生命令” 且测试计划有 “原生命令表只读断言”，但未写明当扩展别名与宿主原生命令同名(如原生 /exit 若存在)时的注册行为。建议钉死保守策略：注册前无法查询宿主命令表时，按扩展命令命名空间规则注册并在 /fsm-commands 中说明；若 1.0.3 提供命令查询能力则先查重、冲突时跳过注册并列入 “未实现/让位” 清单。实现时以实际 API 为准，方向已由 “不遮蔽” 唯一确定。

其余：expectations §7 不变量(undo→parent、redo 恰一次、二次 redo 拒绝、new 重置、注册恰一次)均可在 fake ctx + 真 inMemory 树上直接断言；§9 副作用限会话树/进程退出，无秘密、无网络。

## 四、边界与退出确认

- fsm-1~5 结论不重开；AskUserQuestion 已在 fsm-5 实现，本单元仅命令别名。
- 通过后 P10 结算；剩余仅真实模型 E2E/SA 集成烟雾(须账户/预算授权)与用户验收；命令集扩展按同机制增量加表项，不重开本合同。
## 结算补充

实施对照run03585637返回PASS（0 critical/0 unresolved）。三项记录级P2已即时钉住：Step P3/P4字面注释、cancelled分支测试、/models帮助断言、重注册覆盖语义断言（P2-3保留保守取消语义并记录）。全量121项+tsc 0。**fsm-6-command-translation技术结算PASS，P10完成。**
