# external-isSafeInteger.md

`Number.isSafeInteger`。

- Sites: json-settings.ts:56（数组 length 合法性）。
- Pre: 任意值。
- Post: boolean（整数且 |x| ≤ 2^53-1）；不做转换、永不抛。
- 边界核实（Batch C 义务）：受检上界 0xffffffff = 2^32-1 = 4294967295 ≪ 2^53-1 ⇒ isSafeInteger 对整个合法 length 域恒真，两闸无冲突；length 为 2^53 或非整数/负数/非 number ⇒ false ⇒ 结构化拒绝（json-settings.ts:57）。
- Throw domain: 无。try 内双保险。
