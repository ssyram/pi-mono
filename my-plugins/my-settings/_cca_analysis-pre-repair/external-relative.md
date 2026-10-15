# external: relative (node:path.relative)

- 来源引用点：settings-files.ts:15（`relative(resolve(root), path)`）。
- kind：Node 内建模块函数（宿主提供）。

## Pre
- from/to 为 string；非 string 抛 TypeError（同步）。

## Post
- 返回从 from 到 to 的相对路径；from === to（规范化后）时返回 `""`；to 在 from 之外时结果以 `..` 开头或为绝对路径（跨设备/根切换场景）。纯词法计算，不访问文件系统。

## 可否 throw-reject
- string 入参不抛；非 string 抛 TypeError。
