# external-writeFile.md

node:fs/promises `writeFile`。

- Sites: settings-files.ts:62 `writeFile(temporary, text, { encoding: "utf8", flag: "wx" })`（写临时文件）。
- Pre: temporary 为同目录 UUID 命名新路径；text 为 stringify 产物（合法 JSON 文本）。
- Post: 新建写入；**wx 旗标 = O_EXCL**：已存在即失败，绝不截断既有文件 ⇒ 即便 UUID 撞名也只会失败而不会污染他方 tmp。
- Rejection 域: EEXIST（撞名，概率可忽略）、ENOSPC（盘满）、EACCES/EPERM、ENOENT（目录被并发删除）、EISDIR、路径含 NUL ⇒ settings-files.ts:78（action catch）contained；finally 仍执行 unlink 清理。
- 崩溃窗口: 写入中途进程死 ⇒ 磁盘留部分 tmp（下次撞名概率≈0）；目标文件从未被本调用触及。
- 悬挂义务: 宿主 fs 永不 settle ⇒ action 悬起、队列头阻塞（合同外，queue-L51 报告已列）。
