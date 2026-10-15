# external-getOwnPropertyDescriptors.md

`Object.getOwnPropertyDescriptors`。

- Sites: json-settings.ts:43（copySettings 对每个容器取快照）。
- Pre: 对象。
- Post: 新普通对象，键 = 源全部**自身**属性名（字符串+symbol），值 = 属性描述符副本。访问器属性给 `{get,set}`，数据属性给 `{value,writable,...}` ⇒ json-settings.ts:44-49 的"仅数据属性"与 toJSON 检查、:55 的 length 读取、:59-67 的孔洞检测、:70 的可枚举过滤均以此快照为唯一事实源（检查与复制不重复触发 getter——快照后只读描述符）。
- Throw domain: 原始值实参 ⇒ TypeError（不可达：item 已过 ：34 typeof "object" 闸且非 null）；Proxy 的 ownKeys/getOwnPropertyDescriptor 陷阱可抛 ⇒ 落 json-settings.ts:82 contained。
