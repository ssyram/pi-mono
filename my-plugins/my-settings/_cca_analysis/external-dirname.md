# external-dirname.md

node:path `dirname`。

- Sites: settings-files.ts:49（mkdir 目标）、:50（realpath 目标）、:59（tmp 文件目录）。
- Pre: string 路径；此处为 settingsFilePath ok 值或其派生（绝对路径）。
- Post: 目录分量串；绝对路径的 dirname 恒绝对。
- Throw domain: 非 string TypeError ⇒ :82 contained；string 域内不抛，无 I/O。
