# external-basename.md

node:path `basename`。

- Sites: settings-files.ts:50（target 文件名分量）、:59（未用——tmp 名由 MY_SETTINGS_DEFAULT_PATH 字面量拼成，实参仅 :50）。
- Pre: string 路径。
- Post: 末段文件名串；无 I/O。
- Throw domain: 非 string TypeError ⇒ :82 contained；string 域内不抛。
