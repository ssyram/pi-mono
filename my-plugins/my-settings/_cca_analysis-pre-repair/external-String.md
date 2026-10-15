# external: String (内建构造器/转换函数)

- 来源引用点：settings-error.ts:6（`String(error)`，error 为捕获到的 unknown）。
- kind：ECMAScript 内建。

## Pre
- 实参为任意值（含 null/undefined/symbol——String() 接受 symbol，不像模板字面量那样抛）。

## Post
- 常规输入：返回人类可读字符串（null→"null"、undefined→"undefined"、symbol→"Symbol(...)"、对象→ToString 链结果）。
- 转换结果用作错误 message；调用点对返回值无进一步结构要求。

## 可否 throw-reject
- 敌意对象（Symbol.toPrimitive / toString / valueOf 抛出）可同步 throw——调用点 settings-error.ts:5-7 的 try 已包含并以 "Unknown settings error" 回落，不依赖其不抛。
- 宿主灾难性 OOM/进程终止除外。
