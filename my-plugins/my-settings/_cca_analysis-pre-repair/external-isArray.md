# external: isArray (Array.isArray)

- 来源引用点：settings-service.ts:78（`Array.isArray(data.session)`）、settings-operation.ts:11（`Array.isArray(input)`）、json-settings.ts:18（`Array.isArray(value)`）。
- kind：ECMAScript 内建静态函数。

## Pre
- 实参为任意值（三个调用点均传入已过其他守卫或完全未验的 unknown）。

## Post
- 恒返回 boolean：实参为数组（Array 奇异对象含跨 realm 数组）→ true；否则 false（含 Proxy 包裹的真数组 → false，按规范以内部槽判定）。

## 可否 throw-reject
- 对任意输入不抛、无副作用（规范内建，无用户可覆写路径）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定不算普通 JS 异常）。
