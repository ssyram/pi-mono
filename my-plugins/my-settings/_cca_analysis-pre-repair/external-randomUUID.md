# external: randomUUID (node:crypto.randomUUID)

- 来源引用点：settings-files.ts:44（临时文件名唯一化）。
- kind：Node 内建模块函数（宿主提供）。

## Pre
- 无（无参调用；Node ≥ 14.17 运行时由宿主保证）。

## Post
- 返回 RFC 4122 v4 UUID 字符串（36 字符，含 4 个 `-`），进程内重复概率可忽略；不修改可观察全局状态。

## 可否 throw-reject
- 正常 Node 运行时（宿主进程）不抛；仅在加密熵源不可用的极端环境抛。宿主灾难性 OOM/进程终止除外。
