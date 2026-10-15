# Contract Expectations — skillref-1-reference-modifiers

本清单在基础设施编码前从用户确认与函数级规约抽取；用于直接实现测试，不表示已开展独立审查。

## 1. 契约源

- 主设计：`docs/design/subplans/skillref-1-reference-modifiers.md`，P1–P9。
- 函数规约：`docs/design/subplans/skillref-1-modifier-functions.md`，§2–§5。
- 用户裁决：只实现基础设施、不接入；所有 pi 对接函数不抛出且不返回非法值。

## 2. Schema 字段

- Occurrence：start/end/reference/operation/escapeIndex；有序非重叠原文索引。
- Context：reference/start/prefix/separator/escaped/fragment；同一行光标左侧。
- LoadedResource：entry/content；仅字符串本体。
- Suggestions：prefix/items；合法候选 value/label 及可选 description。
- Edit：非空字符串 lines 数组及合法整数 cursorLine/cursorCol。

## 3. 枚举

- print/path 由 `REFERENCE_OPERATIONS` 统一定义，解析与菜单共享。
- separator 单/双冒号；失败 loader只返回 null，不返回候选或 undefined。

## 4. 流程

- 原文识别 → 转义或精确加载 → 局部替换 → 依路径去重附入；不扫描输出。
- 光标上下文 → 唯一精确加载 → 菜单或委托 → 返回合法归一化结果。
- apply 失败 → 原文本/光标快照；suggestions 失败 → null；gate失败 → false。

## 5. 行为

- 零个/任意多个空格及 Tab 的单冒号形式等价，不跨行；保留双冒号。
- 不存在、大小写不精确、同名歧义、缺路径、读失败均不转换。
- 正文保留 frontmatter、换行与参数；path 是文件绝对路径。
- 转义删除一次反斜杠、不加载；无成功 print 不附说明。
- 普通冒号/普通路径不显示资源操作菜单。

## 6. 时序与状态

- 只持有单次转换缓存；资源清单及读取在新请求重新取得。
- 操作按原始位置替换；menu apply 重算上下文、核对 prefix/item。
- 下层触发字符保留并合并冒号；不持有跨会话可变状态。

## 7. 不变量

- 未处理区间保持原文索引；已处理非操作文本保持不变。
- 打印路径集合唯一且保序；有限区间逐个消费，保证终止。
- 所有成功回调值符合 pi schema；可恢复异常不跨越边界。
- 用有限生成组合覆盖空白/分隔符/重复引用，不新增 property-testing 依赖。

## 8. 性能

- 同一次发送对同一 query 复用加载结果，不跨请求缓存。
- 匹配输入与两项操作集合有限；不引入 timers/watchers/processes 或资源扫描。
- 不设置无依据的耗时阈值。

## 9. 安全与副作用

- 所有本轮文件只在 my-plugins/skill-ref。
- 不修改 index.ts、原 autocomplete.ts、tool.ts，不注册事件、命令或工具。
- 不修改用户既有未提交修改；不调用模型或使用付费 API。
- getEntries/read/下层回调/错误形状/getter 异常均有定向测试。

## 10. 跨组件一致性与边界

- 发送与菜单共享精确加载语义及操作集合，不猜资源。
- 真实 Editor 自动触发只在测试内装配，不表示正式接入。
- 首行原生命令防护与正式输入/附件/reload链路留到接入阶段。
- 独立审查未启动；本清单与测试结果不能冒充用户验收。
