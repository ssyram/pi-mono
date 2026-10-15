# external-has.md

属性存在性判定，两种形态：

## Form 1: `in` 运算符（沿原型链）

- Sites: settings-kind.ts:23 `key in raw`（pickValidFields 键存在闸）；settings-files.ts:34 `"code" in error`（ENOENT 判定的短路第二段）。
- Pre: 右操作数为对象；原始值 ⇒ TypeError。settings-kind.ts:23 的 raw 仓域为 copySettings 输出或 `{}`（普通对象）⇒ 不可达，越域异常落 pickValidFields try（settings-kind.ts:34）contained；settings-files.ts:34 的 error 经 `instanceof Error` 短路收敛为 Error 实例 ⇒ 不可达，越域（陷阱 Proxy）落内层空 catch（settings-files.ts:35）再落 ：36，contained 且不吞原始错误。
- Post: boolean；原型链可见 ⇒ `"toString" in raw` 对无自身该键的 JSON.parse 对象为 true——settings-kind.ts:27 的种类闸保证继承函数值不可能进入 picked（kindOf 得 "function"，与六种期望皆不等 ⇒ 诊断+丢弃），无值泄漏。

## Form 2: `Set.prototype.has`

- Sites: json-settings.ts:37 `ancestors.has(item)`（环检测）。
- Pre/Post: 任意实参，boolean，不抛。
