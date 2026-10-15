# external: writeFile (node:fs/promises.writeFile)

- 来源引用点：settings-files.ts:47（`await writeFile(temporary, text, { encoding: "utf8", flag: "wx" })`）。
- kind：Node 内建模块函数（宿主提供），Promise API。

## Pre
- path 为 string；data 为 string（调用点 text）；encoding "utf8"、flag "wx"（调用点固定）——"wx" 要求目标不存在，已存在则失败。

## Post
- 成功：目标文件以独占创建方式写入完整内容后关闭；磁盘内容为全量 text（失败不留部分写入的目标文件；可能有临时内核缓冲）。
- 失败：reject Error（.code）：EEXIST（已存在，"wx"）、EACCES、ENOSPC、EISDIR、EIO。失败时可能已创建空/部分文件（调用方负责清理，见 settings-files.ts:51）。

## 可否 throw-reject
- 恒以 Promise 形式表达：resolve 或 reject。
