# external: resolve (node:path.resolve)

- 来源引用点：settings-files.ts:14（`resolve(root, name)`）、settings-files.ts:15（`resolve(root)`）。
- kind：Node 内建模块函数（宿主提供）。

## Pre
- 每个 string 参数为 string；非 string 实参抛 TypeError（同步）。root 为空串时不抛，但以 process.cwd() 为基准（语义前提：调用方传入绝对根目录，如 getAgentDir() 结果）。

## Post
- 返回绝对、规范化的路径字符串（解析 `.`/`..`、合并重复分隔符）；不访问文件系统，不做 symlink 解析；不校验 NUL 字节。
- `resolve(root, name)` 中 name 为相对路径时结果挂在 resolve(root) 之下。

## 可否 throw-reject
- string 入参不抛；非 string 抛 TypeError。
