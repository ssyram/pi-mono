# external-push.md

`Array.prototype.push`。

- Sites: json-settings.ts:53（leave 帧）、:62（数组元素帧）、:70（对象属性帧）。
- Pre: 数组（pending，调用帧局部）。
- Post: 末尾追加，length 增；规模 O(节点数) ⇒ 堆内存有界增长（宿主灾难域单独声明）。
- Throw domain: 无。三处均在 try 内，双保险。
