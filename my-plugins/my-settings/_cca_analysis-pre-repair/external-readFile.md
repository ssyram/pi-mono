# external: readFile (node:fs/promises.readFile)

- 来源引用点：settings-files.ts:25（`await readFile(path, "utf8")`）。
- kind：Node 内建模块函数（宿主提供），Promise API。

## Pre
- path 为 string（非 string/含 NUL → 拒绝 ERR_INVALID_ARG_VALUE，不产生部分读）。encoding 固定 "utf8"（调用点）。

## Post
- 成功：resolve 整个文件的 utf8 文本（含 BOM 原样、空文件为 `""`）；不修改文件。
- 失败：reject Error（携带 .code）——ENOENT（不存在）、EISDIR（目录）、EACCES、EMFILE、ELOOP 等。ENOENT 与其他错误由调用方区分（extern-model：仅 ENOENT 允许当空配置）。

## 可否 throw-reject
- 恒以 Promise 形式表达：resolve 或 reject；不会同步 throw。
