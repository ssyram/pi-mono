# Decisions — skillref-1-reference-modifiers 审核发现处置

2026-10-14 用户裁决，对照 [cca-pre-post-review-20261014.md](cca-pre-post-review-20261014.md)：

- F1 越界光标：修——applyCompletion 对 item.value 单次读值（核实 pi 不钳制 provider 返回的光标后裁决"修"）。
- F2 可变 entry：修——loadExactReference 返回防御副本，path 取读取前校验值；副本构造中的属性读取异常折叠为 null。
- F3 空 items：修——归一化按数组索引复制，敌意自定义迭代器不参与，输出条数恒等于输入 length。
- F4 registry 逃逸：修（追加授权）——try 覆盖整个遍历，任何元素访问/迭代异常折叠为 []；registry.ts 与其测试纳入检查配置。
- F5 异步拒绝：修——applyCompletion 委托路径对违规 thenable 附 catch 吞除后续拒绝；姊妹点 shouldTriggerFileCompletion 的 gate 返回 thenable 同类收束（依据用户长期硬边界：pi 对接不得留宿主级未处理拒绝）。
- F6 转义种类前缀：不修，按前缀规则现行行为，记为已知问题（设计文档 §6）。
- 首行规则：首个有意义行行首引用归官方，修饰符原样保留；发送与补全两侧同规则实施（P10）。

全部修复含回归测试（合计 56 项通过）；审核反例脚本 `.pi/cca-counterexamples.ts` 保留为修复前证据——F1–F5 断言对修复后源码不再成立，F6 仍可复现（已记录已知问题）。

2026-10-15 追加裁决：菜单候选改为 `:print`/`:path`/`\:` 三项并列；`\:` 为 bare 转义——发送时只删反斜杠（纯字面冒号替换），无需操作名，后接文本不属于 occurrence；escaped 上下文一律无候选，F6 不对称因此消解。测试 63→66 项通过。
