# external: getAgentDir (@earendil-works/pi-coding-agent)

Manifest external ✔（manifest.json `external/getAgentDir`）。仓内生产代码唯一调用点：extension.ts:60（`registerMySettingsService(pi.events, resolver, getAgentDir(), withFileMutationQueue)` 实参位置，mySettings 加载期求值）。

## Interface / native evidence

packages/coding-agent/src/config.ts:605-611：无参；`process.env[ENV_AGENT_DIR]`（config.ts:585，`PI_CODING_AGENT_DIR`）有值则 `expandTildePath(envDir)`，否则 `join(homedir(), CONFIG_DIR_NAME, "agent")`（通常 `~/.pi/agent`，arch/prototype.md §2 同义）。

## Pre / Post

- Pre: 无实参；进程环境可读（隐含）。
- Post: 返回字符串目录路径；env 覆写路径经 tilde 展开后原样返回（不做存在性检查——不保证目录存在）。

## Failure assumption

- 接口未承诺不抛。病态环境下可抛：`os.homedir()` 无法确定主目录时抛（Node 语义）；`expandTildePath` 为纯字符串变换，env 为非字符串不可能（process.env 值恒 string|undefined）。正常环境事实不抛，但**不得作为前提**。
- 仓内收口：唯一调用点位于 mySettings 的整体 try（extension.ts:13-88）内，抛出 ⇒ extension.ts:85-88 → `reportSettingsError` + 插件惰性，无外泄。

## Caller obligations

- 调用方必须把本调用置于自身 try 边界内（extension.ts 已满足）。
- 返回值作为 `globalRoot` 传入 service（settings-service.ts:17）；后续所有路径解析以该串为根——非存在性担保意味着"目录未建"由文件层首写时的 mkdir 兜底（settings-files 侧义务，非本外部义务）。
