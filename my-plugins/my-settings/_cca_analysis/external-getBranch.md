# external: getBranch (SessionManager.getBranch)

**不在 manifest externals 中**（extmodel 抽取缺口，已在批次报告第 3 项上报；本文件按真实调用名建档，勿据 manifest 否定其存在）。仓内生产代码唯一调用点：extension.ts:40（getBranch 端口内 `owner.context.sessionManager.getBranch()`）。**callgraph 自环 `extension.ts:L36::getBranch → 自身` 即此调用，非递归**（open-questions §静态图已知噪声）。

## Interface / native evidence

packages/coding-agent/src/core/session-manager.ts:1469-1479：`getBranch(fromId?: string): SessionEntry[]`——自 `fromId ?? this.leafId` 沿 `parentId` 走到根，`path.reverse()` 后返回；无 I/O，纯内存遍历；`byId.get(startId)` 未命中返回 `[]`。

## Pre / Post

- Pre: 接收者满足 ReadonlySessionManager（含 `getBranch`，session-manager.ts:255）。
- Post: 返回**新鲜数组**（函数内局部构建，:1470-1477），旧→新排序（:1477 reverse）；元素为树内**活体条目引用**（非深拷贝）；startId 缺失时为空数组。

## Failure assumption

- 原生实现无抛出路径（Map.get/数组操作）。接口层面按可失败外部边界对待（extern-model.md:18）；仓内收口：extension.ts:37-44 try/catch ⇒ 结构化 OPERATION_FAILED（extension.ts:42-44）。

## Caller obligations

- 时点快照语义：返回后宿主可切分支/追加条目，数组不追踪变化；消费方只读（仓内 readSessionPatches 满足，settings-session-log.ts:39-53），不得原位修改元素。
- 必须先过 isCurrent 门再调用（仓内唯一调用点 settings-query.ts:42→48 满足）；端口本身无现役守卫。
- 结构性损坏条目由消费方逐条诊断跳过（readSessionPatches 侧义务），本外部不担保条目形状。
