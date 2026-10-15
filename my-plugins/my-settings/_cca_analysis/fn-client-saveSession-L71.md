---
fn: "client.ts:L71::saveSession"
source: "client.ts"
line: 71
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-saveSession-L71.md

## 综述

createMySettingsClient 返回对象中的单表达式箭头 `saveSession: (save: SettingsSave) => invoke({op:"save-session", save})`（client.ts:71）。公共入口（entries.json）。把 session 日志追加请求包装后整体委托 client.ts:L27::invoke，自身无逻辑。

## 契约（调用者驱动）

- PRE：无 no-throw 前提——任意实参可接受；`SettingsSave` 形状校验在服务端（parseSettingsOperation，settings-service.ts:40）。
- POST：同步返回 invoke 的 promise；恒 fulfilled，值为 SettingsResult；绝不 reject、绝不同步抛。
- 工厂期 `initialFailure` 已设时（client.ts:17-26），无视实参恒返回 INVALID_REQUEST（经 client.ts:31）。

## 自身异常合同

体仅含对象字面量 + async 函数调用（调用从不同步抛；invoke 的 promise 恒 fulfilled，见 fn-client-invoke-L27.md）。⇒ 无向外 throw/reject 路径。宿主灾难性 OOM/终止不属于 JS 异常合同（open-questions.md）。"save-session 只追加日志、不写文件、日志条目只记 values"（arch/prototype.md §5）由服务端 appendSessionSettings 路径兑现，本函数只透传 op 字符串 `"save-session"`。

## 霍尔逻辑 SP

{P: args ∈ 任意值}
body: return invoke({op:"save-session", save: args})（client.ts:71）
{Q: 返回 promise fulfilled ∧ 值满足 SettingsResult；无异常逃出}

## 并发/异步义务

无自有状态；并发调用各自进入独立 invoke 帧（client.ts:28-29）。
