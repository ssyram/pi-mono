---
fn: "extension.ts:L46::appendEntry"
source: "extension.ts"
line: 46
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-appendEntry-L46.md

## 综述

resolver 构造的 SettingsSession 端口方法（extension.ts:46-53，对象字面量成员 extension.ts:22-55）。同步把一条日志补丁写入**当前**会话日志：转发 `pi.appendEntry(type, data)`（extension.ts:48），成功返回 `{ok:true, value:undefined}`，任何同步异常收敛为 `settingsFailure("OPERATION_FAILED", error)`（extension.ts:50-52）。

**图噪声声明**：callgraph 中 `extension.ts:L46::appendEntry → 自身` 为假阳性——extension.ts:48 是外部调用 `pi.appendEntry(...)`，非递归（open-questions.md §静态图已知噪声；本次核实一致）。

## 契约（调用者驱动）

调用者：service 侧经 SettingsSession 抽象；仓内唯一真实调用点 appendSessionSettings（settings-session-log.ts:23），实参恒为 `type = MY_SETTINGS_ENTRY_TYPE`（protocol.ts:3）、`data = { values }`（深拷贝产物，settings-session-log.ts:21-24）。

- 对调用者的 POST：同步返回 protocol.ts:71 `SettingsOutcome<void>`，绝不抛。成功 ⇒ 宿主已向当前会话日志追加 `custom` 条目（type/customType/data 透传）；合并优先级即日志顺序（arch/prototype.md §2 addNewPiLog、§5）。失败 ⇒ `{ok:false, OPERATION_FAILED}`，调用方决定整体保存结果（AndSession 语义由 save 执行器批次闭合）。
- PRE（调用方义务）：紧邻的 isCurrent 门通过（仓内满足：settings-session-log.ts:18-20，且 isCurrent→copy→appendEntry 全同步无 await）；`data` 只含 `{values}`（prototype §2：日志条目只记 values 不记 scope）。本端口**不做校验、不改写实参**——校验在上游 save 执行器（透传语义）。
- 无 active 守卫，同 getBranch（fn-extension-getBranch-L36.md）：绕过 isCurrent 直调可向非现役会话写日志；仓内无此路径。

## 自身异常合同（逐路径）

- extension.ts:48 `pi.appendEntry(type, data)`：外部边界，同步 void。原生证据（packages/coding-agent/src/core/extensions/loader.ts:391-394）：先 `assertActive()`——扩展 failed/stale 时**会抛**（loader.ts:254-259；runner.ts:738-742 抛 staleMessage Error）；后委托 `runtime.appendEntry`（绑定为宿主 action，runner.ts:431），宿主持久化路径含同步文件写（openSync/writeFileSync，session-manager.ts:1177-1184），可抛 I/O 异常。**两类抛出都被 extension.ts:50-52 捕获** → 结构化 OPERATION_FAILED。不依赖 Pi 对插件异常的兜底（runner.ts:1111-1120 的 containment 存在但仅作佐证不作前提——本端口在端口调用栈内，不经 runner.emit）。
- extension.ts:49 返回字面量不抛。
- 全函数无显式 `throw`；唯一逃逸口已闭合。宿主 OOM/终止非 JS 异常合同。

## 霍尔逻辑 SP

{P: type/data 由调用方保证（type=MY_SETTINGS_ENTRY_TYPE，data={values}）；pi.appendEntry 为同步 void 外部操作}
body: pi.appendEntry(type, data)（extension.ts:48）；抛 ⇒ settingsFailure(OPERATION_FAILED)（extension.ts:50-52）
{Q: 返回 {ok:true, value:undefined}（宿主已受理追加）或 {ok:false, OPERATION_FAILED}；无异常逃出；失败时本插件作用域内无部分状态（宿主侧是否半写入不可见，属外部边界黑盒）}

## 并发/异步义务

- 全同步 ⇒ 与 bind/shutdown/resolver 无交错窗口；追加顺序 = 调用顺序。
- 日志追加**不经** withFileMutationQueue（该队列只串行化文件读改写，settings-files 侧）；并发 save-session 请求的两次追加按到达顺序入日志，合并时后写覆盖前写——与 prototype 的"日志顺序即优先级"一致，无需加锁。
- isCurrent→appendEntry 的 TOCTOU：仓内消费点全同步，窗口为零（settings-session-log.ts:18-25）；跨 await 的新消费方必须重新过门，否则存在"就地 sessionId 改写（session-manager.ts:1713/:1745）后仍写入新身份会话"的理论窗口——由调用方纪律闭合，非本端口义务。
- shutdown 后不可达性：新请求经 resolver 得 undefined、在途请求经 isCurrent 得 false，均到不了本端口（见 fn-extension-on-L82.md 并发节）。
