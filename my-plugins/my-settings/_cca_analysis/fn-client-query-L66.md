---
fn: "client.ts:L66::query"
source: "client.ts"
line: 66
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-query-L66.md

## 综述

createMySettingsClient 返回对象中的单表达式箭头 `query: (query: SettingsQuery) => invoke({op:"query", query})`（client.ts:66）。公共入口（entries.json：extern-model.md Public entry surfaces）。把查询请求包装成 `SettingsOperation` 后整体委托 client.ts:L27::invoke，自身无逻辑。

## 契约（调用者驱动）

- PRE：无 no-throw 前提——任意实参（含 undefined）可接受；`SettingsQuery` 形状校验在服务端（parseSettingsOperation，settings-service.ts:40），客户端不预校验。
- POST：同步返回 invoke 的 promise；恒 fulfilled，值为 SettingsResult（protocol.ts:43）；绝不 reject、绝不同步抛。
- 工厂期 `initialFailure` 已设时（client.ts:17-26），无视实参恒返回 INVALID_REQUEST（经 client.ts:31）。

## 自身异常合同

体仅含对象字面量创建 + 调用 async 函数 `invoke`：JS 语义下 async 函数调用从不同步抛（异常封装进返回 promise），而 invoke 的 promise 已被证明恒 fulfilled（fn-client-invoke-L27.md SP）。无属性读取、无 getter、无 I/O、无 JSON。⇒ 无向外 throw/reject 路径。宿主灾难性 OOM/终止不属于 JS 异常合同（open-questions.md）。

## 霍尔逻辑 SP

{P: args ∈ 任意值}
body: return invoke({op:"query", query: args})（client.ts:66）
{Q: 返回 promise fulfilled ∧ 值满足 SettingsResult；无异常逃出}

## 并发/异步义务

无自有状态；并发调用各自进入独立 invoke 帧（invoke 每帧独立 response/closed，client.ts:28-29）。语义（defaults < global < local < session 合并、scope 省略即 session 等）由服务端 executeSettingsQuery 兑现，本函数只透传。
