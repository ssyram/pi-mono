# external: isAbsolute (node:path.isAbsolute)

- 来源引用点：settings-files.ts:11（`isAbsolute(name)`）、settings-files.ts:16（`isAbsolute(within)`）。
- kind：Node 内建模块函数（宿主提供）。

## Pre
- 参数为 string（Node 对非 string 抛 TypeError；调用点 settings-files.ts:11 的 name 已由 typeof 短路保证为 string；:16 的 within 是 path.relative 的返回值，恒为 string）。

## Post
- 返回 boolean：POSIX 下以 `/` 开头即绝对路径。

## 可否 throw-reject
- string 入参不抛；非 string 抛 TypeError（同步）。
