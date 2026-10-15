# external: isFinite (Number.isFinite)

- 来源引用点：json-settings.ts:5（`typeof value === "number" && Number.isFinite(value)`）。
- kind：ECMAScript 内建静态函数。

## Pre
- 实参为任意值（本调用点 L5 短路已验 typeof 为 "number"）。

## Post
- 恒返回 boolean：实参为有限数值（含 -0，排除 NaN/±Infinity）→ true；否则 false（非 number 类型按规范恒 false——本调用点已保证 number）。

## 可否 throw-reject
- 对任意输入不抛、无副作用（规范内建，无用户可覆写路径）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定不算普通 JS 异常）。
