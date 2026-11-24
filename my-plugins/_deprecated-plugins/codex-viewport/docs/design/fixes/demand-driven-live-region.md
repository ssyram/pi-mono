# 修复记录：Demand-driven LiveRegion

状态：retrospective。本文在实现后补录，不冒充编码前门禁产物。用户在看到修改方案后以`Change the shit.`授权实施。

## 1. 现象与复现

旧实现进入managed后把area设为`[min(naturalTop,2),terminalBottom)`。Submitted message以上大部分可见screen被逐行`EL2`替换为空白；普通run又因大capacity很少在运行中spill history。Width/height变化永久fallback。

回归入口：`demand-driven-runtime.test.ts`与`resize-epoch.test.ts`。调用链：`agent_start → captureNativeEntryBaseline → ManagedRenderer.render → terminal.write`。

## 2. 根因

逻辑finality、可见稳定和physical displacement被合并；area同时错误地eager-top-expand与bottom-anchor。Geometry change又只有永久native fallback，没有epoch re-entry。

## 3. 参考对照

Pi native renderer在短内容时只占当前inline rows；width变化走native full reflow。Codex-style history insertion只应在真实内容压力下推进，不应预先清空可见screen。

## 4. 修复方案

- Area改为variable `[top,bottom)`，由native frame seed。
- Overflow先增长bottom，到terminal bottom后才按实际数量降低top。
- Finalized visible rows原位保留；source-order不可见前缀才spill。
- Height/footer/widget变化保持managed。
- Width执行一次native redraw，再gate+DSR进入新managed epoch。
- Width failure path区分successful-redraw recapture failure与partial native redraw failure，禁止错误同步重试并清理ownership。

## 5. 正确性论证

- 根因消除：无eager full-height allocation；无真实overflow则stable prefix不写。
- 不变量：ledger仍只commit最大连续finalized前缀；history input不含volatile UI；single terminal owner保持。
- 无回归：原有ledger/DSR/widget/history/handoff tests与新增demand/resize/failure tests同时通过。

## 6. 测试清单

| 类型 | 用例 | 状态 |
|---|---|---|
| 回归 | stable submitted prefix无`EL2` | 已加 |
| 回归 | one-row overflow只增长一行 | 已加 |
| 回归 | finalized visible原位且static suffix不重复paint | 已加 |
| 回归 | agent运行中history insertion | 已加 |
| 回归 | height managed、width one-redraw re-entry | 已加 |
| 边界 | recapture timeout dirty catch-up、partial redraw、catch-up throw、agent-end cancel | 已加 |
| 全量 | 59 tests / 12 suites、tsc、npm check、global Pi smoke | 已通过 |

## 7. 代码更新清单

| 范围 | 改动 | 状态 |
|---|---|---|
| entry/area/growth/frame | variable native-seeded geometry | 已改，未commit |
| renderer/history | demand growth与in-run spill | 已改，未commit |
| runtime/resize | height rebase与width epochs | 已改，未commit |
| failure lifecycle | gate cleanup、partial-write sanitation与race containment | 已改，未commit |
| tests | demand-driven与resize regressions | 已加，未commit |

## 8. 文档更新清单

| 文档 | 状态 |
|---|---|
| README、architecture、detailed-design | 已更新 |
| detail contracts与Hoare/SCCO proofs | 已更新 |
| known-state、verification-plan、audit summary | 已更新 |
| 本retrospective fix record | 已补录 |
