---
function: extension.ts:L32::on
source: {file: "extension.ts", line: 32}
self_consistency: aligned
---

## 综述

`session_shutdown` 生命周期回调（匿名箭头函数 `() => { active = undefined; }`；manifest id "on" 为提取器按注册调用命名的伪影，open-questions 已记录）。它把闭包变量 `active` 复位为 undefined，使插件立即停止代表该会话行事。

## 调用者驱动契约

### Pi 宿主（session_shutdown 派发；注册点 extension.ts:32）
- 前提：无（任意参数、任意次数；幂等）。
- 期望：返回后 `active === undefined`。连锁效果：resolveSession（extension.ts:10-11）对所有请求返回 undefined → 服务不再 accept（settings-service.ts:87）→ 客户端得到结构化 SERVICE_UNAVAILABLE；在途 execute 的 isCurrent（extension.ts:14，`active === owner`）转为 false → 其写入/日志步骤以结构化错误收场。

## 异常合同

### 函数自身
- 不可能 throw：函数体仅一条对闭包变量的赋值，无 callee、无 I/O、无属性访问。无显式 throw。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在合同内（单独注明）。

### 服务/插件边界的包含效果
无异常可产生，无包含需求。

## 契约（霍尔逻辑）

### Pre
- 无。

### Post
- 返回后 `active === undefined`（持续到下次 bind 成功）；不抛；返回值无语义（undefined）。

### 对 callee 的期望
- 无 callee。

## 并发
- `active`：[W] L32。事件循环串行化其与 bind、service handler 的先后；无锁需求。与在途 execute 无同步交互（后者经 isCurrent 复验观察复位结果）。

## SP
- [L32] `active := undefined`。正常返回。终止：无循环、无分支。Post 达成。

## [SELF] 前提
- 无。

## 自洽
与 bind 的 owner 建立逻辑、服务端 resolveSession/isCurrent 所有权判定闭环一致。aligned。
