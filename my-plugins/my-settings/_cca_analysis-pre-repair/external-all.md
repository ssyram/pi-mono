# external: all (Promise.all)

- 来源引用点：settings-service.ts:34-37（`await Promise.all([readSettingsFile(globalFile), localFile ? readSettingsFile(localFile) : Promise.resolve({})])`）。
- kind：ECMAScript 内建（宿主 Promise）。

## Pre
- 实参为 promise/值的可迭代集合（本调用点：恰 2 元素数组，元素为 Promise）。

## Post
- 全部 fulfill → resolve **按输入序**的值数组（与完成顺序无关）。
- 任一 reject → 以第一个拒绝原因 reject（其余元素被忽略，不等待）。

## 可否 throw-reject
- 对 promise 数组不同步 throw，只可能 reject；拒绝原因原样透传给调用方（execute 的 L34-37 await 无本地 try → execute reject → svc:89 折叠）。
