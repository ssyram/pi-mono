# external: stringify (JSON.stringify)

- 来源引用点：settings-files.ts:42（`JSON.stringify({ ...existing, ...values }, null, "\t")`）。
- kind：ECMAScript 内建函数。

## Pre
- 首参为可 JSON 序列化对象：无循环引用、无 BigInt 成员（否则 TypeError）、无会抛异常的 getter/toJSON（调用点若 values 来自 copySettings 则恒为普通 JSON 对象，本 Pre 自动满足；独立直调 writeSettingsFile 的 caller 必须自行保证）。
- replacer=null、space="\t"（调用点固定）。

## Post
- 成功：返回 JSON 文本字符串（对象成员按 key 序列化；undefined/函数/符号成员被省略，NaN/Infinity → null；对象 spread 时 `__proto__` 以自有属性复制，不改原型）。根为对象时恒返回 string。
- 失败：同步 throw TypeError（循环结构 "Converting circular structure to JSON"、BigInt）或 getter 异常；throw 时无部分输出。

## 可否 throw-reject
- 会同步 throw；无 reject 形态。
