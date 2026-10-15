# external-add.md

`Set.prototype.add`。

- Sites: json-settings.ts:52 `ancestors.add(item)`（容器入祖先集）。
- Pre: 任意对象值。
- Post: 集含该值，返回该 Set（此处返回值被弃）。
- Throw domain: 对任何实参不抛（Set 内部 SameValueZero 比较）。json-settings.ts:52 在 try 内，双保险。
