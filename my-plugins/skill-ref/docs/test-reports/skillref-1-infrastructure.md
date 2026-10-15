# skill-ref 修饰符基础设施 — 运行记录

## 当前交付

- 已实现独立引用解析、唯一精确加载、正文附入/路径替换、转义、子命令上下文与 provider 装饰器。
- 函数级规约及论证：`../design/subplans/skillref-1-modifier-functions.md`。
- 新代码不被现有 index.ts 引入；未注册 input/session 事件，未改原补全和工具指引。
- 现有 tool.ts 的用户修改保留；本轮格式工具误改现有文件后已撤回本次格式改动。

## 结果

- TypeScript：`tsconfig.modifiers.json`，noEmit，退出 0。
- Biome：新增 18 个 TS 文件的明确路径，error-on-warnings，退出 0。
- node:test：7 个定向测试文件，8 个 suite，41 项通过，0 失败/跳过/取消。
- 真实 Editor 组件：不按 Tab 输入 `/alpha :` 自动弹菜单；普通/未知引用的冒号不弹本插件菜单；现场筛选并选择纯字符项后不展开。
- 边界失败覆盖：registry/reader 异常、下层同步 throw/异步 rejection、undefined/错误形状/稀疏数组、getter 异常、非法光标、非布尔闸门、错误触发字符。
- 无模型请求，无收费 API，无上游文件改动。

## 可复现命令（仓库根执行）

```sh
node_modules/.bin/tsc --project my-plugins/skill-ref/tsconfig.modifiers.json

node_modules/.bin/esbuild my-plugins/skill-ref/src/{reference-occurrences,exact-resource,transform-references,autocomplete-result,modifier-autocomplete,modifier-boundary,modifier-editor,registry,integration}.test.ts \
  --bundle --platform=node --format=esm --packages=external \
  --alias:@earendil-works/pi-tui=./packages/tui/src/index.ts \
  --outdir=my-plugins/skill-ref/.pi/modifier-tests

node --test my-plugins/skill-ref/.pi/modifier-tests/{reference-occurrences,exact-resource,transform-references,autocomplete-result,modifier-autocomplete,modifier-boundary,modifier-editor,registry,integration}.test.js
```

作用域内格式/诊断检查从插件目录执行：

```sh
cd my-plugins/skill-ref
../../node_modules/.bin/biome check --error-on-warnings --max-diagnostics=none --config-path=biome.json \
  src/reference-*.ts src/exact-resource*.ts src/printed-resources*.ts \
  src/transform-references*.ts src/modifier-*.ts src/autocomplete-result*.ts src/registry.ts src/registry.test.ts
```

当前 node_modules 的 pi-tui/dist 类型缺少源码已有的补全扩展字段，因此类型检查沿用仓库源码映射，测试显式 bundle 当前 pi-tui 源码。没有更新依赖或修改 dist。生成测试产物只位于插件 `.pi/modifier-tests/`，该目录由插件本地规则忽略。

## 未完成边界

- 用户限定只实现基础设施，因此真实发送链路、附件/reload集成与模型加载指引未接入；测试安装 provider 不是生产接入。
- 首行规则已裁决并实现（P10，2026-10-14）：首个有意义行行首引用归 pi 官方接管，原样保留（发送与补全两侧）；transformer 不改写任何消息前缀。
- 不保证未解析文本不被其他 pi 原生命令处理，也不能抢在同名首行 extension command之前拦截。
- 根 npm run check包含全仓 --write，与用户禁止修改 my-plugins以外文件的限制冲突，未执行。未运行 npm run build、npm test 或全量 suite。
- 本记录是上述直接测试和诊断的运行依据，不是独立审查或用户验收。

## 2026-10-14 审核后修复（用户裁决 F1–F6 与首行规则）

- F1：applyCompletion 对 item.value 单次读值，异变 getter 无法使候选核对、插入文本与光标失步。
- F2：loadExactReference 读取成功后返回自建副本（path 为读取前校验值）；读者篡改不再影响结果，副本构造中的属性读取异常折叠为 null。
- F3：normalizeAutocompleteSuggestions 按数组索引复制；敌意自定义迭代器不参与，输出条数恒等于输入 length。
- F4：registry.ts listEntries 的 try 覆盖整个遍历（追加授权修改既有文件；biome 顺带归一该文件格式，两文件已纳入检查配置）。
- F5：applyCompletion 委托路径与 gate 违规返回 thenable 时吞除后续拒绝，宿主不再出现未处理拒绝（含 gate 姊妹点）。
- P10：首个有意义行行首引用归 pi 官方接管——发送侧原样保留（含修饰符与转义）、补全侧不弹菜单；句中与后续行不受影响。
- F6：不修，按前缀规则现行行为，记为已知问题（设计文档 §6）。
- 回归测试 +10，registry 既有 5 项纳入运行；既有行首输入的测试按 P10 更新。合计 56 项通过；作用域内 biome（20 文件）与 tsc 无告警。
- 审核反例脚本固化于 `.pi/cca-counterexamples.ts`（修复前状态）：F1–F5 断言对修复后源码不再成立，F6 仍可复现（已记录已知问题）。处置记录见 `../audits/skillref-1-reference-modifiers/decisions.md`。

## 2026-10-14 接入（integration）

- `index.ts`：input handler 在原生展开前调用 transformReferences，仅文本变化时返回 transform（不携带 images → 附件原样保留；无变化返回 undefined 继续原链）；provider 装配为 modifier(外) ∘ name(内)，session_start 重复注册兼容 /reload。
- `tool.ts` promptGuidelines 增加一行：附录已附正文无需再调 try_load_skill_or_prompt（保留用户未提交的 description 修改）。
- 新增 `src/integration.test.ts`（7 项）：真实 registry→match→loader→transform 全链（临时真实文件）、P10 行首透传、转义发送、provider 组合顺序与 reload 重注册。
- 合计 63 项通过（56+7）；biome 22 文件 0 告警；tsc：my-plugins 文件 0 错误。全程序运行暴露两处上游既有环境问题（packages/ai/src/providers/data/azure.json 缺失引用；highlight.js 子路径类型缺失，属 AGENTS.md 记载的 node_modules 陈旧类，修复需重装依赖），与本次改动无关，未代为重装。

## 2026-10-15 增量：三并列候选与 bare 转义

- 文法双分支（`reference-occurrences`）：分支 A 为原“分隔符+完整操作+结尾边界”；分支 B 为 bare 转义“反斜杠+分隔符”，无操作、无结尾边界，occurrence 止于冒号后；旧 `\:print` 输入经 B 等价处理，向后兼容。
- 候选（`modifier-items`）恰三项：`:print`/`:path`/`\:`（分隔符感知）；escaped 上下文为终点态返回空。
- 实现期修正一次正则分组编号错位（分支 B 反斜杠为第 6 组而非第 5 组），被测试立即捕获。
- 测试 63→66（+bare 转义解析/转换/集成）；编辑器测试改为方向键选 `\:` 项并验证发送侧字面冒号。66 项全部通过，biome/tsc 同前无告警。
