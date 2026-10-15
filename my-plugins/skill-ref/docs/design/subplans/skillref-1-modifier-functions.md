# 修饰符基础设施 — 函数级规约与论证

本文件细化 [主设计](skillref-1-reference-modifiers.md) 的识别、转换与补全组件；先完成本规约，再实现独立模块，不接入 pi 入口。

## 1. 范围、复用与边界

- 本轮授权：新增基础模块、定向测试、只作用于新增模块的检查配置。现有 index.ts、autocomplete.ts、tool.ts 均不改。2026-10-14 追加授权：修复 registry.ts（F4，含其测试与检查配置纳入）。
- 复用 `SkillRefEntry`、`findExact` 和 pi 的 `AutocompleteProvider` 类型；文件读取沿用现有工具的 UTF-8 原文语义，但不依赖注册工具的模块，避免牵入 UI/工具注册依赖。
- 所有输入文本/光标参数遵守 pi 的类型合同；第三方 provider 返回值、getter 和回调可能异常或错误形状，不能默认合法。
- 本轮的公开 transformer 返回字符串，不是 input handler；不注册事件、不添加前导换行、不替换编辑器、不改变模型指引。首行防护仍属于未来接入义务。
- 所有本轮新建文件在 `my-plugins/skill-ref/`，源文件每份不超过 200 非空非注释行。顶层仅声明，不持有定时器/全局可变缓存。

## 2. 数据合同与文法

### 共享数据（reference-modifier.ts）

- `REFERENCE_OPERATIONS`：唯一操作枚举来源，值为 print/path；发送匹配与菜单均消费该集合。
- `ReferenceOperation`：上述有限集合的成员。
- `ModifierSeparator`：单冒号或双冒号。
- `ReferenceOccurrence`：start/end 为原文 UTF-16 索引，reference 为含 `/` 的资源标识，operation 为合法操作或 null（bare 转义），escapeIndex 为反斜杠的原文索引或 null；按 start 升序、互不重叠。
- `ModifierContext`：reference、start（操作 token 起点）、prefix、separator、escaped、fragment；前缀只取光标左侧，位置在当前行内。
- `LoadedResource`（exact-resource.ts）：entry 与成功读取的原文 content。
- `ResourceReader`：`(entry: SkillRefEntry) => string`；可抛异常，属于内部读取边界，必须由 loadExactReference 收束，不直接交给 pi。
- `AutocompleteEdit`（autocomplete-result.ts）：lines 为非空字符串数组；cursorLine/cursorCol 为非负整数，指向 lines 内合法位置。

### 文法（reference-pattern.ts）

- 引用从文本开头或空白/括号/引号/等号/常用句读边界后开始，不能从 URL、普通文件路径或普通 token 的内部截取 `/name`。
- 名称片段不含空白、斜杠、反斜杠、括号、引号、等号或句读分隔符；允许非空名称片段之间的冒号，包括 skill/prompt 限定名。
- 完整发送形式：引用 + 零个或多个空格/Tab + 可选单个反斜杠 + 单/双冒号 + 完整操作 + 结尾边界。另有 bare 转义形式（2026-10-15）：引用 + 零个或多个空格/Tab + 单个反斜杠 + 单/双冒号，无操作、无结尾边界，occurrence 止于冒号后，其后文本不属于区间。
- 分离形式的空白不含换行。`:printer`、`:print/child`、`:print:other` 不满足操作结尾边界。
- 部分补全文法只允许小写字母操作片段；种类前缀大小写沿用 findExact。紧贴的 `/skill:`、`/prompt:` 不是修饰符上下文。
- 句读边界是文本语法，不是资源存在证明；最终必须通过唯一精确加载。

## 3. 函数规约

### 3.1 parseReferenceOccurrences(text: string): ReferenceOccurrence[]

- 落点：reference-occurrences.ts。Caller：transformReferences；callee：共享文法与操作枚举。
- Requires：有限原文字符串。Ensures：只返回完整文法命中的区间，不读取文件，不改原文，无外部副作用。
- 分支：没有匹配 → 空数组；有匹配 → 从边界捕获计算真实引用起点、末尾和可选转义索引，记录对应合法操作。
- 退出：全部匹配枚举结束后返回数组，不存在 undefined 返回分支。
- 循环：每个匹配消费非空引用+操作，全局匹配索引严格前进；不变量为已记录区间有序、互不重叠且对应原文。因此有限输入保证终止。
- 论证：固定文法排除非法前后边界；位置由同一次匹配推导，不因后续替换而漂移；唯一外部行为是创建数组，满足 post。

### 3.2 loadExactReference(entries: SkillRefEntry[], query: string, read?: ResourceReader): LoadedResource | null

- 落点：exact-resource.ts。Callers：transformReferences、provider 回调。Callees：findExact、isAbsolute、readFileSync 或注入 reader。
- Requires：query 为字符串；entries 来自当前请求，不保留跨请求状态。Ensures：唯一同写精确匹配、读取前校验的绝对非空文件路径、读取结果为字符串才返回本体，否则 null；永不向 caller 抛读取或匹配异常。返回的 entry 是自建副本（path 为读取前校验的原值），不是调用方可变对象。
- 分支：匹配数非 1 → null；路径不是字符串/绝对路径 → null；读取抛异常或返回非字符串 → null；副本构造期间的属性读取异常 → null；成功 → {entry: 副本, content}。读者在读取后篡改或破坏原对象不影响已返回结果。
- 文件系统/注入 reader 为可能抛出 callee，其所有执行位于 try/catch 内；findExact 的元数据访问异常也收束为 null。
- 论证：findExact 的精确性与计数条件排除猜选，路径及字符串检查排除无本体；catch 穷尽可恢复异常出口，故 caller 只见合法 union。副作用仅为 reader 声明的读取。

### 3.3 formatPrintedResources(contents: string[]): string

- 落点：printed-resources.ts。Caller：transformReferences；callee：有限数组 join。
- Requires：按首次成功引用排序、已按路径去重的原文列表。Ensures：空数组返回空串；否则返回主设计规定的说明与 `\n---\n` 分隔附录。
- 无 trim/frontmatter/参数替换，无副作用。两个出口均为字符串。
- 论证：join 保序、保留各输入字符串，有限列表终止；格式化不扫描正文，故不能递归兑现正文示例。

### 3.4 transformReferences(text: string, entries: SkillRefEntry[], read?: ResourceReader): string

- 落点：transform-references.ts。Caller：未来 input adapter 或独立测试；callees：3.1/3.2/3.3。
- Requires：有限原文，entries 是本次清单；可失败 reader 仅经 3.2 调用。Ensures：成功 print/path 转换、转义删除一次反斜杠、失败区间不变；返回字符串且不向 caller 抛可恢复读取异常。官方区域豁免按 P10 执行（见下）。
- 状态：片段数组、原文已消费末尾、有序按路径去重正文、请求内按 query 缓存的 LoadedResource|null。
- 每轮先保留区间前的普通原文；转义 → 只删除 escapeIndex 的一个字符，不加载；未转义 → 查询/缓存精确加载结果。bare 转义（2026-10-15）：`/name \:` → `/name :`，occurrence 止于冒号后，其后任意文本不属于 occurrence（`\:print` 即 `\:`+普通文本，与旧形式等价）。
- 官方区域豁免（2026-10-14 裁决，P10）：occurrence.start 等于整条输入第一个非空白字符位置时，原样保留该区间（含修饰符与转义）、不加载、不转换；按位置判定，不探测资源存在。句中与后续行不受影响。
- 加载失败 → 原区间；成功 path → 完整绝对路径；成功 print → 原引用标识，且若路径未登记则添加原文。之后推进已消费末尾。
- 最后保留尾部原文，连接全部片段，再追加 3.3 返回的附录；即使零成功/零区间也返回合法字符串。
- 循环不变量：已消费区间的转换满足契约，其间原文未改；正文路径唯一且首次出现顺序保持；剩余索引仍对应原文。每轮消费一个有限区间，保证终止。
- 论证：callee 3.2 将读取失败变成 null，分支对 null 保留原文；原始索引拼接排除长度改变带来的误替换；不重复扫描输出排除递归。副作用仅为受控读取与请求内状态。

### 3.5 extractModifierContext(lines: string[], cursorLine: number, cursorCol: number): ModifierContext | null

- 落点：modifier-context.ts。Callers：三个 provider 回调。Callee：共享部分文法。
- Requires：pi 提供非空 lines、合法光标。Ensures：只识别当前行、光标左侧末尾的完整引用+操作前缀；不读文件、不修改输入。
- 分支：末尾结构不满足文法 → null；紧贴的裸种类前缀 → null；其余 → 基于匹配计算 reference/start/prefix/separator/escaped/fragment。
- 光标右侧不作为 prefix；分离空白仅空格/Tab，因此不能跨行找资源。
- 官方区域（2026-10-14 裁决）：匹配引用起点恰为整个 lines 缓冲的第一个非空白字符位置（跨行计算首行首列）时返回 null，与发送侧 P10 同一判定；该位置归 pi 官方接管，不提供修饰符菜单。
- 论证：匹配锚定行末并保留引用边界，故普通冒号和路径内部斜杠不会被当成资源操作；返回索引均来自当前 beforeCursor。无循环或外部副作用。

### 3.6 getModifierItems(context: ModifierContext): AutocompleteItem[]

- 落点：modifier-items.ts。Callers：provider suggestions/applyCompletion。Callee：共享枚举。
- Requires：3.5 产生的上下文。Ensures：合法 value/label/description 字符串；未转义上下文恰三项候选——`:print`（"append full text"）、`:path`（"absolute file path"）、`\:`（"literal, no expansion"），值随上下文分隔符（`::` 变体同理）；escaped 上下文返回空（终点态，菜单关闭）。
- 分支：escaped → 空；fragment 非空 → 仅保留以 prefix 开头的操作项；fragment 空 → 三项全列（`\:` 无法打字筛到，仅随未过滤菜单提供）。有限枚举保证终止。无外部副作用。

### 3.7 normalizeAutocompleteSuggestions(value: unknown): AutocompleteSuggestions | null

- 落点：autocomplete-result.ts。Caller：provider getSuggestions 委托路径。Callee：Array.isArray、字符串检查。
- Requires：任意第三方返回值，包括 undefined、getter 抛异常和错误形状。Ensures：只能返回新建合法建议对象或 null，不把原对象/数组/getter继续传给 pi，不抛异常。
- 分支：非对象、prefix 非字符串、items 非数组/空数组、候选 value/label 非字符串或 description 非字符串且非 undefined → null；通过 → 复制字段成普通对象；访问任意字段异常 → null。
- 复制按数组索引进行（2026-10-14 修复 F3）：输入数组上的自定义 Symbol.iterator 不参与，输出条数恒等于输入 length（≥1）；敌意迭代器无法制造空结果或改变复制内容。
- 仅复制合法字段，description 为 undefined 时省略该可选字段；不是将 undefined 作为顶层结果。
- 论证：所有外部字段访问在 catch 边界内，成功返回数据已被快照成合法普通对象；失败统一为官方 nullable 返回类型。有限列表终止，无外部状态写入。

### 3.8 normalizeAutocompleteEdit(value: unknown): AutocompleteEdit | null

- 落点：autocomplete-result.ts。Caller：provider applyCompletion 委托路径。Requires：任意下层返回值。
- Ensures：新建非空字符串 lines 数组及合法整数光标，或内部 null；不抛异常。该 null 不直接返回给 pi。
- 分支：对象/数组/元素/整数/光标范围检查任何失败 → null；全部通过 → 复制 plain object；字段访问异常 → null。
- 论证：光标范围检查阻止 pi 访问不存在行或列，复制阻止原对象 getter 后续抛出；有限数组检查终止。副作用无。

### 3.9 createModifierProvider(current: AutocompleteProvider, getEntries: () => SkillRefEntry[], read?: ResourceReader): AutocompleteProvider

- 落点：modifier-autocomplete.ts。Caller：未来 session_start adapter；本轮不注册。
- Requires：pi 提供合法 provider 输入参数；下层回调、getEntries、读取、triggerCharacters getter 可能失败。
- Ensures：返回完整的三个回调与合法 triggerCharacters；合并下层字符和 `:`，不因下层 triggerCharacters getter 抛出而使 factory 抛异常。
- 分支：读取/过滤下层触发列表失败 → 只声明 `:`；成功 → 只保留单字符字符串并去重合并。闭包仅保存依赖，无请求缓存或长生命周期句柄。
- 论证：触发字符字段在独立 catch 中归一化，所有回调由下面固定合同提供，因此 factory 不输出缺失/undefined callback。

#### getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null>

- Requires：pi 的合法 lines/光标/options；Ensures：Promise 只 resolve 合法建议或 null，不 reject。
- 分支：signal 已 abort → null；上下文不存在/资源不可直接加载 → await 下层并经 3.7 归一化；资源有效 → 3.6 候选，空列表 → null，非空 → 合法建议。
- 完整 try/catch 包含上下文提取、getEntries、下层调用与 await；同步 throw、异步 rejection、返回形状异常均到 null。
- 论证：自身结果由已验证类型构造，第三方结果由 3.7 快照；await 位于 catch 内覆盖 reject，因而 pi 永不收到 undefined 或 rejected Promise。

#### applyCompletion(lines, cursorLine, cursorCol, item, prefix): AutocompleteEdit

- Requires：pi 的合法 lines/光标/item/prefix。Ensures：始终返回合法编辑结果，不抛异常；失败返回原文本/光标的快照。
- 进入时保存未修改快照。item.value 恰读一次（F1，2026-10-14）：候选核对、插入文本与光标计算共用同一读值，异变 getter 无法使三者失步。重算上下文，核对 prefix、唯一加载结果、item.value 是否属于当时可选列表。
- 不是本组件候选 → 调用下层（传副本以保护 fallback），经 3.8 归一化；null → 原快照。下层违规返回 thenable/Promise 时，先以 Promise.resolve(...).catch 吞掉其后续拒绝再归一化（F5，2026-10-14），宿主不再出现未处理拒绝。
- 是本组件候选 → 只替换当前操作 prefix，保留其他行/引用名/右侧文字，追加空格，光标移到插入末尾。
- 任何同步异常 → 原快照。新的 cursorCol = 操作起点 + 插入值长度 + 1，由字符串拼接可证不越界。
- 论证：fallback 建立于外部调用之前；下层异常、错误形状或越界结果均不能泄漏，局部替换保持合法数组/光标。副作用只可能是下层自身行为，不注册/发送。

#### shouldTriggerFileCompletion(lines, cursorLine, cursorCol): boolean

- Requires：pi 的合法 lines/光标。Ensures：始终返回 boolean，不抛异常。
- 有操作上下文且资源可直接加载 → true；否则读取下层可选回调：没有声明回调是正常接口状态，返回 true以保持编辑器默认允许原生 Tab 补全；非函数非法字段 → false；合法回调的布尔结果透传，非布尔结果或异常 → false。
- gate 违规返回 thenable/Promise 时同样吞掉其后续拒绝，并按非布尔结果处理 → false（F5 姊妹点，2026-10-14）。
- 论证：已认领路径固定 true；无可选回调沿用框架默认 true，而不是把正常缺席当错误；非法值及异常固定 false。所有出口均为 boolean，undefined 不跨越 pi 边界。

## 4. 组合论证与未完成边界

- 同一文法用于发送与光标上下文，同一 loader用于发送与补全；没有将 UI 模糊候选偷换为发送对象。
- 官方区域豁免两侧同源：发送侧按整条输入首个非空白索引判定，补全侧按跨行首个非空白行列判定，物理位置一致，两侧不会在同一位置给出矛盾行为。
- 三个直接 pi 回调分别用 null、原合法快照、false收束失败；下层及 getter 都在包围整个计算的异常边界内，返回对象被归一化，不能靠 pi 的外层异常处理维持安全。
- 论证适用范围为 pi 给出的合法调用参数及 JS 可捕获异常；OOM、进程被杀等运行环境终止不是函数可恢复返回路径。
- 基础 transformer不防护首行原生展开；未接入时不存在实际输入链路和模型指引变更，不能宣称用户发送行为已经生效。

## 5. 直接测试与完整性义务

- 每个函数有对应定向测试；覆盖正例及上述所有失败出口。
- 直接 pi 回调必须测试：getEntries throw、reader throw、下层同步 throw/异步 reject、undefined/错误形状、触发字符 getter throw、非法编辑行/光标、缺失或非布尔 gate。
- 合法结果通过真实 Editor 的 public API 测试：输入 `/name :` 自动出现菜单、筛选后仍可选执行/纯字符项；只在测试内安装 provider，不加载插件入口或调用模型。
- 本插件根检查配置显式包含新增源文件与测试，不能以仓库根 tsconfig 未包含插件而声称类型通过。
- 根 npm run check 含全仓 --write，与用户绝对禁止修改 my-plugins 以外文件冲突；本轮运行作用域内类型/格式/定向功能检查，不能执行全仓写入式检查。
- 完整性：推导、分支、退出、callee合同、有限循环与假设链在各函数节列明；没有用测试或自述代替论证。
