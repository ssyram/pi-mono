# external-all.md

`Promise.all`。

- Sites: settings-query.ts:37 `Promise.all([loadFile(globalFile.value, validated.value), localFile ? loadFile(localFile.value, validated.value) : Promise.resolve({} as Settings)])`（executeSettingsQuery 的两路来源并行读，唯一调用点）。
- Pre: 实参为可迭代对象；非可迭代 ⇒ 同步 TypeError（settings-query.ts:37 恒为新建数组字面量 ⇒ 数组迭代器，无用户代码，不可达）。元素 promise 化经 PromiseResolve：native promise 直采（loadFile 返回 native async promise、`Promise.resolve({})` 为 native）⇒ 不咨询用户 thenable。
- Post: 恒返回新 promise；全部元素 fulfill ⇒ fulfill 为保序值数组 `[global, local]`；任一元素 reject ⇒ 以**首个** rejection reject。
- 本仓裁决：两元素均已证恒 fulfill（fn-settings_query-loadFile-L9.md always-settles 定理；external-resolve.md Form 2）⇒ **该调用点 Promise.all 不可能 reject**，executeSettingsQuery :37 的 await 必以 fulfilled 数组推进（Batch C accept-settle 义务组成件）。
- Throw/reject domain: 调用点域内无异常；无元素 reject ⇒ 无 rejection 产生。
