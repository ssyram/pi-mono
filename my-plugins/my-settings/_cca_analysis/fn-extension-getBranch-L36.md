---
fn: "extension.ts:L36::getBranch"
source: "extension.ts"
line: 36
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-getBranch-L36.md

## 综述

resolver 构造的 SettingsSession 端口方法（extension.ts:36-45，对象字面量成员 extension.ts:22-55）。同步返回捕获上下文所属会话的当前分支条目（旧→新），包成 `SettingsOutcome<readonly SettingsEntry[]>`；try/catch 收敛为 `settingsFailure("OPERATION_FAILED", error)`（extension.ts:42-44）。

**图噪声声明**：callgraph 中 `extension.ts:L36::getBranch → 自身` 为假阳性——extension.ts:40 是外部方法调用 `owner.context.sessionManager.getBranch()`，非递归（open-questions.md §静态图已知噪声；本次核实一致）。

## 契约（调用者驱动）

调用者：service 侧经 SettingsSession 抽象；仓内唯一真实调用点 executeSettingsQuery（settings-query.ts:48，其先于 settings-query.ts:42 调 isCurrent），产物交给 readSessionPatches 逐条消费（settings-session-log.ts:35-58）。

- 对调用者的 POST：同步返回 protocol.ts:70 `SettingsOutcome<readonly SettingsEntry[]>`，绝不抛。`{ok:true}` 时 value 是**新鲜数组**（原生实现局部构建 path 后 reverse，session-manager.ts:1470-1477），元素为宿主树内**活体条目引用**——快照时点语义；旧→新顺序（reverse 于 session-manager.ts:1477）。
- PRE（调用方义务）：必须先过 isCurrent 门（仓内调用点满足，settings-query.ts:42 先于 :48）。本端口**无 active===owner 守卫**：active 被替换/清空后若被直调，仍会返回旧捕获上下文的分支——仓内无绕过 isCurrent 的路径，新增消费方必须维持"先 isCurrent"纪律。
- 失败语义：`{ok:false, OPERATION_FAILED}` ⇒ 查询方把 session 层按"来源读取失败"处理（诊断 + 跳过 session 层，arch/prototype.md §2/§4 readCurrentSessionPatches 失败路径的端口侧投影）。

## 自身异常合同（逐路径）

- extension.ts:40 `owner.context.sessionManager`：属性读取，普通对象不抛；宿主注入异常访问器时抛 ⇒ :42 捕获。
- extension.ts:40 `.getBranch()`：外部方法。原生证据：纯内存叶→根遍历（session-manager.ts:1469-1479），无 I/O、startId 缺省返回 []，真实实例上不抛；接口上按可失败外部边界对待（extern-model.md:18）⇒ catch → settingsFailure（extension.ts:42-44）。settingsFailure 不抛（settings-error.ts:3-10）。
- 返回对象字面量构造不抛。
- 全函数无显式 `throw`；唯一逃逸口已闭合；不依赖 Pi 兜底。宿主 OOM/终止非 JS 异常合同。

## 霍尔逻辑 SP

{P: owner = resolver 捕获 const（extension.ts:18，非空）；owner.context.sessionManager 满足 ReadonlySessionManager}
body: v := owner.context.sessionManager.getBranch()（extension.ts:40，外部）；抛 ⇒ settingsFailure(OPERATION_FAILED)（extension.ts:42-44）
{Q: 返回 {ok:true, value:v}，v 为旧→新 SessionEntry 快照数组（元素活体引用、只读纪律），或 {ok:false, OPERATION_FAILED}；无异常逃出}

## 并发/异步义务

- 全同步 ⇒ 求值原子；但返回值是**时点快照**：返回瞬间之后宿主可切分支/追加条目，数组不追踪后续变化（元素对象为共享活体引用，理论上可被宿主原位修改——消费方只读，readSessionPatches 满足，settings-session-log.ts:39-53）。
- isCurrent 与本调用之间的窗口：同步消费（settings-query.ts:42→48 同一同步段）内无让点 ⇒ 窗口内不可能插入 bind/shutdown；跨 await 的消费纪律由调用方批次闭合。
- 与 shutdown 交互：active 清空不影响本端口取值（无守卫），但仓内调用链保证 shutdown 后到不了这里（isCurrent 先行返回 false，settings-session-log.ts:18-20 同门）。
- 会话身份（义务 a 相关）：本端口读的是**捕获的 owner.context**，不重读 active——"分支读的是哪个会话"由 resolver 三元身份检查 + isCurrent 时刻谓词共同界定；本函数自身不做身份裁决。
