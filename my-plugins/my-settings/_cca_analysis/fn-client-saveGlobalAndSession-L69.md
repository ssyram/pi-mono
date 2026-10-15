---
fn: "client.ts:L69::saveGlobalAndSession"
source: "client.ts"
line: 69
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-saveGlobalAndSession-L69.md

## 综述

createMySettingsClient 返回对象中的单表达式箭头 `saveGlobalAndSession: (save: SettingsSave) => invoke({op:"save-global-and-session", save})`（client.ts:69）。公共入口（entries.json）。把组合保存请求包装后整体委托 client.ts:L27::invoke，自身无逻辑。

## 契约（调用者驱动）

- PRE：无 no-throw 前提——任意实参可接受；`SettingsSave` 形状校验在服务端（parseSettingsOperation，settings-service.ts:40）。
- POST：同步返回 invoke 的 promise；恒 fulfilled，值为 SettingsResult；绝不 reject、绝不同步抛。
- 工厂期 `initialFailure` 已设时（client.ts:17-26），无视实参恒返回 INVALID_REQUEST（经 client.ts:31）。

## 自身异常合同

体仅含对象字面量 + async 函数调用（调用从不同步抛；invoke 的 promise 恒 fulfilled，见 fn-client-invoke-L27.md）。⇒ 无向外 throw/reject 路径。宿主灾难性 OOM/终止不属于 JS 异常合同（open-questions.md）。组合语义（文件步骤失败仅诊断继续、日志步骤决定整体结果、文件与 session 日志非事务、无 PARTIAL_SAVE）由服务端 executeSettingsSave 按 arch/prototype.md §5 兑现，本函数只透传 op 字符串 `"save-global-and-session"`。

## 霍尔逻辑 SP

{P: args ∈ 任意值}
body: return invoke({op:"save-global-and-session", save: args})（client.ts:69）
{Q: 返回 promise fulfilled ∧ 值满足 SettingsResult；无异常逃出}

## 并发/异步义务

无自有状态；并发调用各自进入独立 invoke 帧（client.ts:28-29）。
