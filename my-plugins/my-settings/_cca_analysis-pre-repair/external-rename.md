# external: rename (node:fs/promises.rename)

- 来源引用点：settings-files.ts:49（`await rename(temporary, path)`）。
- kind：Node 内建模块函数（宿主提供），Promise API。

## Pre
- old/new 为 string；old 存在（调用点 temporary 刚写入成功）；new 的父目录存在（调用点 mkdir 已保证）。

## Post
- 成功：POSIX rename(2) 语义——new 被整体原子替换为 old 的内容（同目录/同文件系统内）；并发读者见旧内容或新内容之一，无中间态；old 不再存在。若 new 是目录而 old 是文件则失败。
- 失败：reject Error（.code）：ENOENT（old 消失，如被外部删除）、EACCES/EPERM、EXDEV（跨文件系统——调用点 temporary 与 path 同目录，不会发生）、EISDIR/ENOTDIR、ELOOP。失败时 new 保持原内容不变（强异常安全）。

## 可否 throw-reject
- 恒以 Promise 形式表达：resolve 或 reject。
