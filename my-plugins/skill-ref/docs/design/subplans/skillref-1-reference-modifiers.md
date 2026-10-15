# skill-ref 引用修饰符 — 细化设计

本设计让显式资源引用在发送时变为正文或路径，并在 `/name :` 后自动提供资源子命令补全。

状态：已确认主方案；首行规则已裁决（P10 官方接管，2026-10-14）。本文只定义 Q/D；实现与测试状态见文末退出状态。

## 1. Task Overview 与范围

- Owner：`my-plugins/skill-ref/`。沿用现有 `docs/design/`，本次为专项子计划。
- 来源：本轮用户需求、后续纠正及对带空格冒号方案的确认；现有 `principles.md`、`architecture.md`、`research.md`。
- 范围：资源引用识别、精确加载、发送转换、子命令补全、转义和模型加载指引。
- 排除：上游改动、替换编辑器、资源目录扫描、模糊猜选、递归展开被加载正文、额外审查。
- 文档与代码的后续同步仅限本插件；现有未提交修改不得覆盖。

导航：§2 Q → §3 D.root → §4 识别与加载 → §5 发送 → §6 补全 → §7 集成边界 → §8 测试合同。

本轮基础设施的确定签名、完整分支和 pi 边界不抛出/合法返回论证见 [函数级细化](skillref-1-modifier-functions.md)。该文档对本轮基础设施的接口细节优先；接入义务不在本轮实现范围。

## 2. Q — 已确认方向与事实前提

### Q.I

- Q.I.1：显式修饰符应让真实资源在发送时兑现为完整正文或绝对文件路径。
- Q.I.2：输入 `/name :` 后应自动出现子命令补全；单独的冒号、普通文字后的冒号不得显示本插件菜单。
- Q.I.3：没有唯一精确命中本体时，插件不替换原文，不以候选、模糊命中或默认选择代替真实资源。
- Q.I.4：同一资源文件重复打印只附入一次，所有成功打印引用都移除修饰符；用户可通过转义发送纯字符。
- Q.I.5：所有文件改动必须位于 `my-plugins/`；不能修改上游。

上述条目整理自用户明确需求与裁决。沿用现有 skill/prompt 双资源口径；不把“SKILL 本体”解释成排除已有 prompt 功能。

### Q.A（源码依据已核实）

- Q.A.1：registry 来自 `pi.getCommands()`；同名 skill/prompt 可共存，限定名可消歧。依据：`src/registry.ts`、`src/match.ts`。
- Q.A.2：`readResource` 返回 UTF-8 文件原文，缺路径和读失败会抛异常。依据：`src/tool.ts`。
- Q.A.3：编辑器的自动触发字符匹配 token 起点；`/name:` 不能靠注册 `:` 自动触发，`/name :` 可以。依据：`packages/tui/src/components/editor.ts` 的 `buildTriggerPattern`。
- Q.A.4：input handler 在原生 skill/prompt 展开前执行；异常会被捕获，不能靠抛异常改变发送控制流。依据：`agent-session.ts`、`extensions/runner.ts`。
- Q.A.5：原生模板和 skill 展开都要求文本以对应斜杠调用开头；前导换行可阻止其展开。依据：`prompt-templates.ts` 的 `expandPromptTemplate`、`agent-session.ts` 的 `_expandSkillCommand`。
- Q.A.6：首行 extension command 分发早于 input handler；撞名命令可能使本插件没有处理机会。依据：`agent-session.ts` 的 `prompt`。

不新增经验性 Q.E。

## 3. D.root — P / M / R

### P

- P1：可执行形式为 `/name::print`、`/name::path`，以及 `/name` 后接零个或任意多个空格/Tab再接 `:print`、`:path`；支持现有限定名。`/name:print`、`/name :print`、`/name   :print` 等价，path 同理；不跨行。转义为 bare 形式（2026-10-15 裁决）：`╬转义╭+分隔符单独成义，发送时只删反斜杠，后接文本不属于引用区间；无需写操作名。
- P2：自动补全入口为同一行的 `/name` + 一个或多个空格/Tab + `:`；紧贴形式只承诺手输及 Tab 补全，不承诺新建菜单的自动触发。
- P3：执行必须满足名称唯一且同大小写精确命中、文件路径有效且读取成功；不成立的引用逐段原样保留。
- P4：print 留下原引用名，删除操作符及带空格形式的连接空白；path 替换整个组合。
- P5：正文按成功 print 的首次出现顺序附入，以资源登记的绝对路径去重；同一登记路径只附入一次。不同路径的符号链接不承诺按 inode 去重。
- P6：只解释原始输入一遍；被附入正文和转义输出不得作为新输入继续展开。
- P7：转义输出字面量，不加载；失败引用不妨碍其他独立引用成功。
- P8：除成功引用区间、显式转义区间和打印附录外，原文及图片保持不变；P10 官方区域整体原样保留，不产生任何额外文本变化。
- P9：没有成功 print 时不产生打印附录；没有任何转换时返回 continue。
- P10：首个有意义行（忽略任意前导空白，含换行）行首的引用默认归 pi 原生命令处理：该引用区间（含修饰符与转义）原样保留、不加载、不转换，:print/:path 即普通参数；补全侧同位置不提供修饰符菜单。句中与后续行不受影响。（2026-10-14 用户裁决，取代原“首行前导换行防护”候选。）
- P.global：上述规则约束本子计划全部后代；不得修改 `my-plugins/` 以外文件、注册新资源扫描器或引入跨会话可变状态。

### M

- D.reference（展开至 §4）：产出原始区间与唯一资源本体，或者明确未解析结果。
- D.send（展开至 §5）：组合局部替换、正文去重及附录，保留其他文本和附件。
- D.completion（展开至 §6）：识别光标附近的资源操作上下文，仅对可直接加载的资源提供候选。
- D.integration（展开至 §7）：接入现有 provider/input/tool 指引，明确首行原生调用边界。

组合：补全与发送共用识别及加载语义；发送只对已成功加载的原始区间替换，再附入已确定的正文列表。失败区间不会进入替换列表。

### R

- Derivation：Q.I.1/3 要求显式且不猜选的转换，推出 P1/3/4；Q.I.2 推出 P2；Q.I.4 推出 P5/6/7；保护原文与现有功能推出 P8/9。
- Satisfaction：识别提供非重叠区间，加载提供合法资源及正文，转换仅消费成功结果，补全消费同一加载条件，故独立失败不污染其他引用。整体尚有 §7 首行义务，不能宣称无条件满足。
- Optimality：复用现有清单、精确匹配及读取，比另建扫描、改上游或接管编辑器依赖更少；带空格冒号使自动触发无需额外输入桥接。

## 4. D.reference — 识别与加载

### 数据合同

- `ReferenceOperation`：有限集合 print/path。
- `ReferenceOccurrence`：原始文本中 start/end 区间、原引用名、操作（print/path，或 null=bare 转义）、是否转义、紧贴/分离形式。区间使用字符串索引，按 start 升序且互不重叠。
- `LoadedReference`：对应 occurrence、唯一 `SkillRefEntry`、UTF-8 原文；仅加载成功产生。
- 未解析结果：保留 occurrence，但不附资源或替换文本；不混用模糊候选与本体。
- 全部对象属于本次输入/补全请求，不跨会话缓存。

### `parseReferenceOccurrences(text: string): ReferenceOccurrence[]`

- Caller：发送转换；callee：无外部资源接口。Pre：任意字符串。Post：返回所有完整操作/转义区间；无副作用。
- 名称使用现有资源标识语义；仅把末尾完整 `:print`、`:path` 或双冒号形式识别为操作符，`skill:`/`prompt:` 内的冒号不是操作符。单冒号形式与引用名之间允许零个或任意多个空格/Tab，禁止跨行关联。
- 操作必须有完整边界；`:printer`、`::printable`、未知操作不按已知操作的前缀执行。
- 普通文件路径不因包含 `/name` 子串被识别为引用；不得从 token 内部截取资源名称。
- 不新增代码块/引号豁免：显式完整语法仍有效；纯字符示例使用转义。
- 循环只前进扫描原始文本，索引严格增加，有限输入保证终止。非重叠区间保证后续替换可拼接。

### `loadExactReference(entries: SkillRefEntry[], query: string): LoadedResource | null`

- `LoadedResource`：entry + 原文；本分支私有。Caller：发送与子命令补全。
- Callee：现有 `findExact`（返回同大小写全部精确命中）及 `readResource`（返回原文或抛异常）。
- Pre：本次请求取得的资源清单。Post：恰一条精确命中且读取成功才返回本体（entry 为自建副本，path 取读取前校验值）；其他情况返回 null。只读文件，不调用模型或加载工具的执行入口。
- 分支：零命中/多命中 → null；唯一命中 → 读取；缺路径或读失败 → null；成功 → 本体（防御副本）。
- 正确性：唯一匹配排除猜选，读取成功排除无文件本体。补全不调用模糊匹配的 fallback，故与发送的执行条件一致。

## 5. D.send — 发送转换

### `transformReferences(text: string, entries: SkillRefEntry[]): string`

- Caller：input handler。Callees：§4 两个函数；附录格式化。Pre：原始 input 文本与本次清单。Post：满足 root P3–P9；副作用仅为读取资源。
- 扫描得到有限、非重叠区间。遍历时维护未处理原文的起点、已生成片段、按路径有序去重的打印正文。
- 转义先按原始区间处理，不尝试加载：`/name\::print` → `/name::print`，`/name\:print` → `/name:print`，`/name \:print` → `/name :print`；path 同理，允许任意多个连接空格/Tab并原样保留，只删除操作符前的一次转义反斜杠。不全局替换任意 `\:`。bare 转义（2026-10-15）：`/name \:` → `/name :`，occurrence 止于冒号后，其后任意文本原样（`\:print` 即 `\:`+普通文本，与旧形式等价）。
- 官方区域豁免（P10）：occurrence.start 等于整条输入第一个非空白字符位置时，该区间（含修饰符与转义）原样保留、不去转义、不加载、不转换；按位置判定，不探测资源存在。句中与后续行不受影响。
- 非转义：加载失败 → 原区间不变；print 成功 → 保留原引用名并记录正文；path 成功 → 替换为登记的绝对文件路径（不是目录，不额外加引号）。
- 紧贴 print 只删 `:print` 或 `::print`；分离 print 删除全部连接空格/Tab和 `:print`。引用两侧其他空白保持原样。
- 最后拼入剩余原文，再追加附录。没有成功 print 则不追加。
- 同一请求内可复用同一资源的加载结果，避免一次输入多处重复读；每个新请求重新取得清单并读取，不建立持久缓存。
- 循环不变量：已处理前缀的非操作文本完全保留；打印列表只含成功资源且路径唯一；余下区间仍对应原始索引。有限区间每轮消费一个，故终止。
- 正确性：按原始索引拼接保证替换长度不影响后续定位；只附入成功资源实现不猜选；只扫描一次保证转义和资源正文不递归。

### `formatPrintedResources(contents: string[]): string`

- Caller：transformReferences。Pre：按首次成功引用排序、已去重的正文。Post：空列表返回空串；非空返回下述附录。无副作用。
- 固定说明：`The following comes some of the referenced SKILLs, no need to load them manually.`
- 附录为 `\n---\n` + 说明 + `\n---\n` + 正文按 `\n---\n` 连接。
- 每份正文不 trim、不删除 frontmatter、不替换参数、不添加加载工具成功头。
- 正确性：有序连接保序；分隔线是协议边界而非资源内容替换。有限列表保证终止；原正文内可有分隔线，不承诺机器可逆解析。

## 6. D.completion — 子命令菜单

### `extractModifierContext(lines: string[], cursorLine: number, cursorCol: number): ModifierContext | null`

- Caller：provider 的 suggestions/applyCompletion/shouldTriggerFileCompletion。Pre：编辑器提供有效光标。Post：只返回光标所在完整资源操作上下文；无副作用。
- `ModifierContext`：原引用名、操作 token 替换起点、光标前 prefix、紧贴/分离形式。光标右侧文字不参与 prefix。
- 分离形式：当前 token 以 `:` 或 `\:` 开头，左侧同一行最近非空白 token 必须为完整 `/name`；中间仅空格/Tab。
- 紧贴形式：完整 `/name:…`、`/name::…` 或对应转义形式，不把种类限定冒号当操作起点。发送识别与 Tab 补全支持这些形式；不承诺紧贴冒号会自动新建菜单。
- 缺引用、跨行、普通文字或非法结构 → null。向左扫描长度有限，索引递减，故终止。

### provider 协议

- `triggerCharacters` 合并下层已有字符并增加 `:`。转义形式包含 `\`，不能假定它单独启动自动菜单；在 `/name :` 已开的菜单选择转义选项，或按 Tab，均须可用。
- suggestions 顺序：提取操作上下文 → 检查 abort → 精确加载；成功才认领操作菜单；上下文不存在/加载失败则委托下层。
- 候选恰为三项并列（2026-10-15 裁决）：`:print`、`:path`、`\:`（随上下文分隔符为 `::print`、`::path`、`\::`）；描述分别为 "append full text" / "absolute file path" / "literal, no expansion"（插件面向国际用户，提示用英文）。
- 空 fragment 显示三项；输入字母按前缀筛剩对应操作项；`\:` 无法靠打字筛到，用方向键选择。escaped 上下文为终点态：无候选、菜单关闭。
- applyCompletion 必须重算上下文，并核对 prefix、候选值、唯一可加载资源；不匹配则委托。仅替换操作 token 的光标前部分，保留引用名、其他行和光标右侧文本；选中后追加空格并移动光标。
- 没有操作上下文时沿用现有名称补全与首行无后缀透传，不把 `force=false` 全面开放给句中名称补全。
- 正确性：触发字符只使编辑器请求 provider；资源上下文及精确加载决定插件是否认领，因此普通冒号不产生本插件菜单。有限候选集合保证筛选终止。
- 已知偏差（2026-10-14 记录，2026-10-15 消解）：紧贴转义形式无菜单原为 skill/prompt 裸名特例；bare 转义裁决后 escaped 上下文一律无候选（终点态），不对称不复存在，留档。

## 7. D.integration — 接入与首行边界

- input handler 每次惰性获取清单；有转换则返回 transform 并保留附件，无转换则 continue。读取失败由本分支转换为未解析结果，不依赖运行器吞异常实现语义。
- provider 保持在 session_start 注册；沿用 /reload 清除和重新装配机制，不添加 watcher、timer、子进程。
- 模型工具指引明确：本条消息打印附录中已经给出的资源正文无需再次加载；普通未附入的引用仍遵守原加载指引。指引不能保证模型绝不重复调用工具。
- 未来落点：新建专责解析/加载/转换模块，扩展现有 provider 与入口注册；每个源文件不超过 200 非空非注释行，index.ts 仅 re-export。这些是待落实映射，不是现有实现声明。

### 已裁决：首行官方接管（2026-10-14）

首个有意义行（忽略任意前导空白，含换行）行首的引用默认归 pi 原生命令处理：插件对该引用区间（含修饰符与转义）原样保留、不加载、不转换；官方行为下 :print/:path 即普通参数。补全侧同位置不提供修饰符菜单，避免推荐发送时不会被兑现的操作。按位置判定，不探测资源是否存在。

后果：print/path 在该位置不生效；`/workflow :print` 开头会带字面 `:print` 发送。需要修饰符时把引用放在句中或后续行。原“前导换行防护”候选废弃（它会改写用户消息内容）。实现见 P10 及测试。

剩余硬边界：若首行名称撞到 extension command，core 可能在 input 前直接执行命令；本插件不能在仅用 input/provider 的方案中抢先处理。句中或后续行引用不受此入口限制；不修改上游、不接管编辑器的前提下必须保留此边界。

未解析引用的“原样保留”是插件保证，不是禁止 pi 原生命令继续处理它的保证。

## 8. 测试合同与退出条件

后续实现职责包含直接功能测试；本次设计不执行测试，也不增加独立审查。

- 识别：单/双冒号紧贴形式、分离形式及各自转义形式，print/path、限定种类、零空格/任意多个空格/混合 Tab 等价、跨行拒绝、未知操作、普通文件路径、操作前缀边界。
- 加载：唯一同写、同名歧义、错误大小写、模糊候选、不存在名称、缺路径、读取失败；所有失败保持原区间。
- 转换：print/path 混用、重复路径打印一次、部分成功部分失败、原文空白/Unicode、原正文含操作示例不递归、frontmatter/尾部换行保留。
- 补全：自动 force=false 的 `/name :`、普通冒号和不存在资源透传、完整限定名、紧贴形式 Tab、转义候选、筛选、光标右侧文本保留、其他 provider 触发字符保留及 abort。
- 官方区域豁免：首个有意义行行首的 print/path/转义引用发送时原样保留、补全不弹菜单；同消息句中与后续行引用仍正常转换。
- 集成：输入 handler 的 continue/transform、图片保留、首行防护（确认后）、原生命令无后缀透传、reload、非 UI 发送转换。
- 必须直接进行受控交互测试，证明输入 `/真实资源 :` 自动弹菜单而不是只证明 provider 返回候选；不得使用真实付费模型作为此功能测试依据。
- 实施前保存本子计划契约的 expectations；本轮没有启动审核。代码完成后运行项目要求的检查及本插件定向测试，不运行未授权的 build 或全量测试。

当前退出状态：**基础设施与接入均已完成（2026-10-14；2026-10-15 增量：菜单 `:print`/`:path`/`\:` 三项并列 + bare 转义，66 项定向测试通过）**。接入内容：input handler 发送兑现（无变化不干预）、modifier∘name provider 装配、工具指引一行；运行依据见 [基础设施测试记录](../../test-reports/skillref-1-infrastructure.md)，处置记录见 [decisions](../../audits/skillref-1-reference-modifiers/decisions.md)。principles/architecture 已同步 A6/P6 与 M5。
