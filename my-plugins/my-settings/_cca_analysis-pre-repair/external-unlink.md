# external: unlink (node:fs/promises.unlink)

- 来源引用点：settings-files.ts:51（`await unlink(temporary).catch(() => {})`——rejection 被调用点吞掉）。
- kind：Node 内建模块函数（宿主提供），Promise API。

## Pre
- path 为 string。

## Post
- 成功：删除该名字的文件（目录则失败）。
- 失败：reject Error（.code）：ENOENT（不存在——调用点在 writeFile 失败未建文件时即此情形）、EACCES、EPERM、EISDIR、ELOOP。

## 可否 throw-reject
- 恒以 Promise 形式表达：resolve 或 reject；调用点的 `.catch(() => {})` 保证其 rejection 不向上传播（清理尽力而为，可能残留 .tmp 文件）。
