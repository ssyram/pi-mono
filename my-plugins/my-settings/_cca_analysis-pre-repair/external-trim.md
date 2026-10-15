# external: trim (String.prototype.trim)

- 来源引用点：settings-files.ts:11（`!name.trim()`，仅在 `typeof name === "string"` 短路成立后求值）。
- kind：ECMAScript 内建方法。

## Pre
- this 为 string（调用点已由 `||` 链首个 typeof 检查保证；对非 string 调用会 TypeError，但该路径被短路排除）。

## Post
- 返回去除首尾空白的新字符串；原字符串不变。空串/全空白 → `""`（falsy）。

## 可否 throw-reject
- 在上述 Pre 下不抛。
