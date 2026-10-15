# external: join (node:path.join)

- 来源引用点：settings-files.ts:44（`join(dir, \`.${MY_SETTINGS_DEFAULT_PATH}.${randomUUID()}.tmp\`)`）；另 settings-service.ts:30/50 由 execute 使用（构造 `.pi` 根）。
- kind：Node 内建模块函数（宿主提供）。

## Pre
- 每个 string 参数为 string；非 string 抛 TypeError（同步）。调用点 dir 为 dirname(path)（string），模板串恒为 string。

## Post
- 返回规范化拼接后的路径字符串（处理 `.`/`..`/分隔符）；纯词法，不访问文件系统。

## 可否 throw-reject
- string 入参不抛；非 string 抛 TypeError。
