# external: keys (Object.keys)

- 来源引用点：settings-service.ts:41（`Object.keys(defaults).map(...)`）。
- kind：ECMAScript 内建。

## Pre
- 实参为对象（本调用点 defaults 为 copySettings 的 JSON 往返产物——无代理、无抛出性属性的普通对象）。

## Post
- 返回**自有可枚举字符串键**名数组（string 键按插入序、integer-like 键按数值序升前）；对普通对象不抛、不改实参。
- 注意视野：不含 symbol 键、不含不可枚举属性（copySettings 产物经 JSON 往返本就只剩可枚举自有键）。

## 可否 throw-reject
- 普通对象实参不抛；仅敌意对象（Proxy trap / 抛出性内部槽）可同步 throw——本调用点输入性质排除该情形（残余：无）。
