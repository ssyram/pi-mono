---
function: settings-files.ts:L51::catch
source: {file: "settings-files.ts", line: 51}
self_consistency: aligned
---

## 综述

writeSettingsFile 队列 action 清理段（files:50-53）里挂在 `unlink(temporary)` 上的**空 rejection 处理器**（settings-files.ts:51，`await unlink(temporary).catch(() => {})`；manifest 名 `catch` 为提取器对 `.catch` 回调的命名，open-questions.md:21）：unlink 清理失败（临时文件不存在 ENOENT、EACCES/EPERM 等）被静默吞掉，保证 `await` 该表达式永不 reject——后续 files:52 的 rethrow 携带的是**原错误**而非清理错误。它是整个保存 action 唯一的吞错点，吞错范围严格限定在清理义务内。

## 调用者驱动契约

callgraph 入边：`settings-files.ts:L39::queue → catch-L51`（callgraph.json:139-141，action 体内 `.catch(() => {})` 的定义/注册）。真实调用者是 **Promise 机制**：仅当 `unlink(temporary)` 的 Promise reject 时，以拒绝原因同步调度本回调（`.catch(onRejected)` ≡ `.then(undefined, onRejected)`——unlink fulfill 时**不调用**）；调用发生在 action 的 catch 续体（files:50-53）内的 `await` 微任务中。

1. **queue action（files:51，fn-settings_files-queue-L39.md:50-51/66 已落盘期望）**：调它时已保证：实参为 unlink 的拒绝原因（任意 Error/reason）。期望：吞掉任何拒绝、返回 undefined、自身不抛——files:51 的 await 从而不可拒绝，files:52 rethrow 原错误（"清理失败不遮蔽主错误"的 rethrow 语义依赖之）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提**：实参（拒绝原因）可为任意值——body 忽略之；Promise 机制保证仅在 rejection 时以单实参调用。

### Post

- 返回 undefined；**无条件 fulfill 链式 Promise**——`await unlink(temporary).catch(() => {})`（files:51）因此永不 reject，无论 unlink 的失败原因是什么（ENOENT：writeFile 失败路径下临时文件未建成；EACCES/EPERM/ENOSPC：临时文件存在但删除被拒等）。
- 效果（刻意设计）：清理失败无诊断输出、可能残留 `.tmp` 临时文件（唯一被吞的失败——fn-settings_files-queue-L39.md:66 已记）；主错误不受影响（files:52 rethrow 的是 files:50 catch 捕获的原始 error）。
- 异常安全档：nothrow（空 body 无可达异常路径）。

### 对 callee 的期望（下传 demand）

#### （无 callee）
- 空 body：无函数调用、无属性读取、无外部符号。吞错语义由 `.catch` 注册机制与空实现共同承载。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **不向外 throw / 不产生 rejection**：body 为空语句序列——无任何可达异常路径；返回 undefined 使链式 Promise 恒 fulfill。
- 本回调自身就是 unlink rejection 的**包含点**：若去掉 `.catch(() => {})`，files:51 的 await 会因清理失败 reject、**替换** files:52 的原错误（主错误被清理错误遮蔽）——空处理器消除了该遮蔽路径。
- 无 reject 形态（fulfillment 值 undefined）。

### 【服务/插件边界的包含效果】

- 本处理器位于 action（manifest fn settings-files.ts:L39::queue）catch 续体内：其吞错使清理失败**不进入** action 的 rejection 通道——action 的 rejection 恒为原错误（files:52）→ writeSettingsFile reject → execute svc:54 reject → svc:89 → OPERATION_FAILED。
- owner 判据核对：吞掉的是**清理**失败，主操作失败仍以结构化错误报告——不构成"默认值伪装成功"；代价仅为无诊断的 `.tmp` 残留可能（记录为观察，留主 agent 裁决是否需要清理失败报告——fn-settings_files-queue-L39.md:101 同款记录，本文件不重复裁决）。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明；进程死于 unlink 前同样可残留 `.tmp`——queue 文档异常合同已记）。

## 并发

无：本回调由 Promise 机制在 unlink rejection 后微任务调度，运行于 action catch 续体的同步段；无共享可变状态（忽略实参、不触外部变量）；与 lane 语义无交互（清理发生在已失败的 action 内，lane 释放由宿主 finally 保证、与本回调无关）。

## SP

- [L51] `await unlink(temporary).catch(() => {})`：
  - unlink fulfill（临时文件存在且删除成功——rename 失败后的典型路径）→ `.catch` 处理器**不调用**，值透传 → await 正常完成。
  - unlink reject（ENOENT/EACCES/…）→ 处理器以 reason 调用 → 忽略实参、返回 undefined → 链式 Promise fulfill → await 正常完成。
  - 合流：files:51 之后 await 必然正常完成（唯一出口 R），无异常可从本表达式逃逸 → 顺序到达 files:52 `throw error`（原错误）→ action reject。
- 终止：微任务有界（单次 unlink 结果）。Post 达成。

## [SELF] 前提（消解记录与上传清单）

- 无：本回调无任何需 caller 保证的前提（任意 reason 被忽略）、无自身异常、无上传义务。"unlink 失败可被吞" 的 callee 侧需求由 writeSettingsFile/queue 文档对本表达式的建模覆盖（fn-settings_files-writeSettingsFile-L33.md:59），本文件为其实现端确认。

## 自洽

- 与 queue action 的期望（fn-settings_files-queue-L39.md:66 "files:51 …清理失败被吞（全 action 唯一吞错点；unlink 不 sync throw，rejection 被空 catch 消费）"）逐条一致。
- 与 writeSettingsFile 文档（fn-settings_files-writeSettingsFile-L33.md:68 "L51 …是唯一被吞的失败（清理尽力而为，可能残留 .tmp）"）一致。
- owner 判据自检：吞错范围限于清理、主错误报告链（files:52 → svc:54 → svc:89）完整——无成功伪装。aligned。
