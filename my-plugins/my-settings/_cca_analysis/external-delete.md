# external-delete.md

`Set.prototype.delete`。

- Sites: json-settings.ts:22 `ancestors.delete(item)`（leave 帧出祖先集）。
- Pre: 任意值。
- Post: 返回 boolean（是否原在集内），无其他副作用。
- Throw domain: 对任何实参不抛。json-settings.ts:22 在 try 内，双保险。
