# external: dirname (node:path.dirname)

- 来源引用点：settings-files.ts:43（`dirname(path)`）。
- kind：Node 内建模块函数（宿主提供）。

## Pre
- 参数为 string；非 string 抛 TypeError（同步）。调用点 path 为 settingsFilePath 的返回值（绝对路径 string）。

## Post
- 返回路径的目录部分（绝对入参 → 绝对输出）；根路径返回其自身。

## 可否 throw-reject
- string 入参不抛；非 string 抛 TypeError。
