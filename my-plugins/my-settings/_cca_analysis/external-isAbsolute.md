# external-isAbsolute.md

node:path `isAbsolute`（posix 实现于 darwin）。

- Sites: settings-files.ts:13 `isAbsolute(name)`（拒绝绝对配置路径）、settings-files.ts:18 `isAbsolute(within)`（Windows 跨盘 relative 返回绝对路径的兜底闸）。
- Pre: string（:13 typeof 守卫收敛；:18 实参为 relative 产物）。
- Post: boolean，纯正则式判定，无 I/O。
- Throw domain: 非 string 实参抛 TypeError（node:path 校验）——两处均被守卫/产物域排除 ⇒ 不可达；越域落 settings-files.ts:23 catch contained。
