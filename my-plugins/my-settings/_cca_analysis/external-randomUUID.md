# external-randomUUID.md

node:crypto `randomUUID`。

- Sites: settings-files.ts:59 `randomUUID()`（tmp 文件名唯一段：`.settings.json.<uuid>.tmp`）。
- Pre: 无参（disableEntropyCache 默认）。
- Post: RFC 4122 v4 UUID 串；122 位随机 ⇒ 同目录撞名概率工程零 ⇒ writeFile wx 的 EEXIST 通路事实不可达（仍被结构化处理）。
- Throw domain: 文档无失败码；CSPRNG 未初始化等宿主级故障可抛（node 内部 `crypto.randomBytes` 失败）⇒ settings-files.ts:78 contained。崩溃窗口留 tmp 的概率与撞名概率同级（writeSettingsFile 报告已声明）。
