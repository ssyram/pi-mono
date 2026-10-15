# external-realpath.md

node:fs/promises `realpath`。

- Sites: settings-files.ts:50 `realpath(dirname(path))`（target 键的规范化）。
- Pre: 已存在路径（:49 刚建）；解析全部符号链接。
- Post: 规范绝对路径；用作队列序列化键基底与读-改-写目标 ⇒ 与宿主队列的 getMutationQueueKey（file-mutation-queue.ts:16-26，同样 realpath）对同一目录得出同一键 ⇒ 互斥生效。
- Rejection 域: **ENOENT（missing dir）**——:49 与 ：50 之间目录被并发 rmdir 的竞态 ⇒ :82 structured 失败，零写入；EACCES、ELOOP ⇒ 同上。宿主队列内部对非 ENOENT/ENOTDIR 的 realpath 失败选择**重抛**（file-mutation-queue.ts:24），ENOENT/ENOTDIR 退化为 resolved 键（:21-22）——该差异已在 writeSettingsFile 的 fp 契约记录。
- 悬挂义务: 宿主 fs 永不 settle ⇒ 调用方悬挂（合同外，已列）。
