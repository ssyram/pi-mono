# external: mkdir (node:fs/promises.mkdir)

- 来源引用点：settings-files.ts:45（`await mkdir(dir, { recursive: true })`）。
- kind：Node 内建模块函数（宿主提供），Promise API。

## Pre
- path 为 string（非 string/含 NUL → 拒绝）。recursive: true（调用点固定）。

## Post
- 成功：确保目录（含缺失的父级链）存在；目录已存在不抛（recursive 语义）；resolve 首个新建目录路径或 undefined。失败时目标目录可能已部分创建（部分父级建成）。
- 失败：reject Error（.code）：EACCES、EIO、ENOTDIR（路径组件是文件）、EEXIST 仅在非 recursive 下出现、循环 symlink → ELOOP。

## 可否 throw-reject
- 恒以 Promise 形式表达：resolve 或 reject；不同步 throw（参数校验错误亦以 rejection 表达）。
