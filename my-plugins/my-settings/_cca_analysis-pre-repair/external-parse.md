# external: parse (JSON.parse)

- 来源引用点：settings-files.ts:30（`JSON.parse(text)`，text 来自 readFile utf8）。
- kind：ECMAScript 内建函数。

## Pre
- 参数为合法 JSON 文本字符串（调用点 text 恒为 string）。

## Post
- 成功：返回解析出的 JSON 值（null/bool/number/string/array/plain object——JSON 文本不可能产生循环引用或非普通对象）。
- 失败：抛 SyntaxError（非法 JSON、空串、截断文本，如空文件 `""` → "Unexpected end of JSON input"）。

## 可否 throw-reject
- 会对非法输入同步 throw；无 reject 形态。
