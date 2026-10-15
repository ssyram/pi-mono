# external-mkdir.md

node:fs/promises `mkdir`（recursive: true）。

- Sites: settings-files.ts:49 `mkdir(dirname(path), { recursive: true })`。
- Pre: string 路径；recursive 模式。
- Post: 逐级创建缺失目录；**EEXIST 被吞**（目录已存或并发创建竞态均成功）⇒ 并发两个 writeSettingsFile 同目录安全；返回首建目录路径或 undefined（返回值被弃）。
- Rejection 域: EACCES/EPERM、ENOTDIR（分量是文件）、ELOOP、路径含 NUL、path 非 string（TypeError→rejection）⇒ settings-files.ts:82 contained。
- 时序注记: 在队列外执行（入队前）⇒ 保存中止（isCurrent 失败/原文件损坏）仍留下空目录树——与 prototype.md §5 atomicWriteObject（队列内建目录）的 divergence，writeSettingsFile 报告已记观察。
