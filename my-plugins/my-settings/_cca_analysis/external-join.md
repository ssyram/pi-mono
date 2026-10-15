# external-join.md

node:path `join`。

- Sites: settings-files.ts:50 `join(await realpath(dirname(path)), basename(path))`（target = realpath 化目录 + 原文件名）、:59 `join(dirname(target), `.${MY_SETTINGS_DEFAULT_PATH}.${randomUUID()}.tmp`)`（同目录 tmp 名）。
- Pre: string 分段。
- Post: 规范化连接串；:59 保证 tmp 与 target 同目录 ⇒ 同一文件系统 ⇒ rename EXDEV 不可达。
- Throw domain: 非 string TypeError ⇒ :82 contained；string 域内不抛，无 I/O。
