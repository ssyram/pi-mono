# external-stringify.md

`JSON.stringify`。

- Sites: json-settings.ts:79 `JSON.stringify(holder.root)`（无 space）；settings-files.ts:58 `JSON.stringify({...existing.value, ...patch.value}, null, "\t")`（写盘文本，\t 缩进，尾补 `\n`）。
- Pre（throw 域排除证明，Batch C 义务）：规范 throw 仅 (a) 循环结构、(b) bigint。json-settings.ts:79：拷贝树是树（环在 ：37 被拒）、bigint 在 ：34-35 被拒 ⇒ 不可达；settings-files.ts:58：两操作数为 copySettings ok 值（无环无 bigint）⇒ 不可达。
- Post: 合法 JSON 文本；NaN/±Infinity 序列化为 null——两处操作数域已经 isFinite 闸排除 ⇒ 该通路不可达；lone surrogate 按 ES2019 well-formed 转义不抛；只枚举自身可枚举字符串键（symbol/不可枚举静默消失，与 copySettings 丢弃规则一致）。
- Throw domain（残差）: 宿主篡改 `Object.prototype.toJSON`/`Array.prototype.toJSON` 可使 Get 命中抛出钩子——环境篡改域，两调用点均在 try 内（json-settings.ts:82 / settings-files.ts:78）contained。【unknown：宿主原型污染状态】。
