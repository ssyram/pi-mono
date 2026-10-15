# external: appendEntry (ExtensionAPI.appendEntry)

**不在 manifest externals 中**（抽取缺口，已在批次报告第 3 项上报；本文件按真实调用名建档）。仓内生产代码唯一调用点：extension.ts:48（appendEntry 端口内 `pi.appendEntry(type, data)`）。**callgraph 自环 `extension.ts:L46::appendEntry → 自身` 即此调用，非递归**（open-questions §静态图已知噪声）。

## Interface / native evidence

packages/coding-agent/src/core/extensions/loader.ts:391-394：`appendEntry(customType: string, data?: unknown): void`——先 `assertActive()`，后 `runtime.appendEntry(customType, data)`（宿主 action，绑定于 runner.ts:431）。同步、返回 void。types.ts:1747 为接口声明。

## Pre / Post

- Pre: `customType` 为字符串；扩展 API 处于 active（assertActive 通过，loader.ts:254-259 / runner.ts:738-742——failed/stale 扩展**会抛**）；data 可为任意 unknown。
- Post: 成功 ⇒ 宿主已向**当前会话**日志追加 `custom` 条目（customType/data 透传）；含同步持久化路径（openSync/writeFileSync，session-manager.ts:1177-1184，会话文件首写时触发）。extern-model.md:18 明示：同步、可失败、不得依赖 Pi 捕获插件异常。

## Failure assumption

- 两个真实抛出向量：(1) `assertActive()` —— 扩展 failed/stale（loader.ts:254-259）；(2) `runtime.appendEntry` 委托链内的同步持久化 I/O 异常（session-manager.ts:1177-1184 openSync/writeFileSync/closeSync）。
- 仓内收口：extension.ts:47-52 try/catch ⇒ 任何同步抛出转为结构化 `settingsFailure("OPERATION_FAILED")`（extension.ts:50-52）。不依赖 runner 的 handler containment（runner.ts:1111-1120）——端口调用栈不经 runner.emit，该兜底在此根本不适用。

## Caller obligations

- 调用必须处于自身 try 边界（extension.ts:47-52 满足）。
- 失败不得重试、不得部分成功假设：抛出点可能在宿主写入中途，本插件作用域无法观测半写入（黑盒）；调用方以结构化失败决策整体结果（save 执行器侧义务）。
- `data` 形状契约 `{values}` 由上游构造（settings-session-log.ts:23-25）；本外部不做校验，畸形状成为日志垃圾但不抛（读取侧逐条跳过，readSessionPatches）。
