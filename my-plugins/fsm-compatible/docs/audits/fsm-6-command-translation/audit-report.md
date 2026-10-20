复检依据齐备(loader.js:194-199 确认 session_start 期注册合法;:250 `commands.set` 为 Map 覆盖语义，重复注册安全)。写最终对照报告(无写工具，以最终回复交付，由 runtime 持久化到绑定输出路径)。

---

# fsm-6-command-translation 实施后独立 Contract 对照报告(路径 B)

结论：**PASS(0 critical / 0 unresolved)**;3 项记录级 P2,无 BLOCK 项。
对照基础：expectations 十节(本会话前次直读全文在案)；直读 `src/commands/command-aliases.ts`、`test/command-aliases.test.ts`;定点核读 `src/index.ts` 注册点与 pi 1.0.3 宿主注册实现(`loader.js`)。未读 implementation.patch,未执行命令。

## 一、§4 流程与 Step 注释

- **P1(逐项注册→真实 API→真实副作用)**:`registerCommandAliases` 首行注释 `// Step P1: every alias performs a real public action; unimplementable OC commands are reported explicitly instead of being faked.`;五个别名 + /fsm-commands 全部注册，每个 handler 消费真实公开 API(newSession/navigateTree/getContextUsage/shutdown)✓。
- **P2(undo 链)**:`waitForIdle → getLeafId → getEntry → parentId===null 明确拒绝 → 记录 before=leaf → navigateTree(parentId)`,注释 `// Step P2: leaf -> parent; a null parent is a real refusal, not a no-op.` 在位；navigateTree 包 try/catch 且通知原始错误消息(设计确认 P2-1 的 compaction 抛错分支已闭合，测试断言逐字上浮 "session is compacting")✓。
- P3(redo)/P4(new/exit)无字面 Step 标签——与 fsm-5 初审同类字面缺口，记录级(P2-1)。
- 注册点:`index.ts:29` 在组装成功路径上、`openOwnedRuntime` 之前调用，恰在 session_start 内——经宿主源核实该位置合法:`loader.js:194-199` 的 `assertActive` 仅在 extension failed/stale 时抛错，loading 完成后的 session_start 期注册不被拒绝 ✓。

## 二、§5/§7/§9 行为与不变量

- **每命令真实行为**：/new=waitForIdle→newSession;**/undo**=navigateTree(原 leaf 的 parentId),根上(无 entry 或 parentId null)拒绝且零导航；**/redo**=仅当 prevLeaf 非空且 `getEntry(target)` 仍存在才 navigateTree,失效目标清记录并明示；**/usage**=`JSON.stringify(usage)` 渲染真实字段，undefined 分支明示“无数据”；**/exit**=shutdown;**/fsm-commands**=实现集全列 + /share、/models 未实现原因与原生指向 + "native pi commands are unaffected" ✓。
- **cancelled/失败如实**：new/undo/redo 三处 `result.cancelled` 均 notify warning;异常通知 error 且保留消息 ✓。
- **prevLeaf 会话归属单步**：undo 成功才记录 before;redo 成功即清除(恰一次)；每次 session_start 重入经重注册获得全新 `UndoState`——配合 fsm-2 的 per-session session_start,状态随会话切换重置 ✓;`index.ts` 重入先 `handle.close` 再重建，重注册为宿主 Map 覆盖语义(`loader.js:250` `extension.commands.set(name,…)`,不抛错)，每名恰一个 handler,§7 “注册恰一次” 在宿主注册表层成立 ✓。
- **§7 性质**：测试以真 `SessionManager.inMemory` 多轮树断言：undo 目标 deepEqual 原 leaf 的 parentId、previousLeaf=undo 前 leaf、redo 恰一次、第二次 redo 拒绝("second redo must be refused")、根上拒绝且 script.length===0、/new 后 previousLeaf=null(stale 预置后清空)、exit→shutdown 记录 ✓。
- **§9**:副作用限公开 API(会话树/进程退出)；无假命令(不可映射集仅出现在帮助清单，未注册)；原生命令不受影响声明在帮助输出并有测试断言；无秘密、无网络 ✓。

## 三、Findings(全部记录级 P2,无未决行为差异)

**P2-1** `command-aliases.ts` 的 redo 与 new/exit handler 缺字面 `// Step P3` / `// Step P4` 注释(P1/P2 在位)——expectations §4 的字面要求，同 fsm-5 已修先例。

**P2-2** 测试相对叶子 §5 计划与 §7 性质的三处缺口(均为补测试即可，无行为错误)：
1. “注册恰一次” 无显式断言(fake 的 `Map.set` 覆盖语义会掩盖重复注册调用)；宿主侧已由 `loader.js:250` 证实无害，但性质未在测试中钉住。
2. `cancelled:true` 分支(new/undo/redo)零测试执行——叶子 §5 明确计划 “/new 调用与 cancelled 透传”；实现代码行为正确(均有 notify),仅未钉住。
3. 帮助输出断言了 /share 但未断言 /models 条目。

**P2-3** `/new` 在 `cancelled` 时也清 `previousLeaf=null`:取消未建新会话却丢失 redo 能力，属保守方向的未定义语义(叶子未规定)，记录备查。

## 四、测试覆盖与无削弱

3 项新测试全部为行为断言，未删除/削弱既有用例；全量 120 项(117+3)+tsc 0 为实现方报告，按边界未独立复跑。

## 五、结论

实现与事前 expectations 逐条一致，设计确认的两项 P2 钉死项(compaction 抛错 try/catch、无 UI/能力分支)均已落实;P2 均为注释/测试补强，不构成放行障碍。判定 **PASS**,P10 编码义务按本单元合同结算；剩余仅真实模型 E2E/SA 集成烟雾(须账户/预算授权)与用户验收。