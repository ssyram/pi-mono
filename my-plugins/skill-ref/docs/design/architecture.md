# skill-ref — 架构与细化（/workflow §4.2 + §4.3）

> 规模小（4 模块 / ~400 行），按 QPDI「小项目可坍缩」把架构与细化合并为本文件。
> 上游：`principles.md`（意图）、`research.md`（调研 + 已确认裁决 D1–D4）。
> 状态：**待用户确认后进入实现**（2026-07-27）

---

## 1. 核心流程

```
用户在句中打 "/qp" 按 Tab
  └─ editor.handleTabCompletion → forceFileAutocomplete(true)     [上游, force=true]
      └─ provider chain: skillRefProvider(builtinProvider)
          ├─ extractInlineSlashToken → {token:"/qp", start}       [M3]
          ├─ registry.listEntries(getCommands)                    [M1]
          ├─ match.findFuzzy(entries, "qp", 50)                   [M2]
          └─ items → 编辑器菜单 → 用户选中
              └─ skillRefProvider.applyCompletion → 文本变为 "... /qpdi "   [M3]

模型读到 "/qpdi" → 调 try_load_skill_or_prompt({query:"qpdi"})
  └─ registry.listEntries → match.findExact                       [M1,M2]
      ├─ 唯一命中 → readFileSync(entry.path) → 原文 + path/baseDir  [M4]
      ├─ 多条命中 → 歧义提示 + 限定名
      └─ 未命中  → match.findFuzzy → 候选表（无候选则给全量名单）
```

两条链路共用 M1 + M2 —— 这是 R3（两处口径必须一致）的结构性保证。

---

## 2. 数据结构（§3.1）

```
数据结构：SkillRefEntry

字段：
  - kind: "skill" | "prompt" — 资源种类
  - name: string — 裸名（skill 已剥掉 "skill:" 前缀，不含前导 "/"）
  - qualifiedName: string — `${kind}:${name}`，用于同名消歧
  - description: string — 来自 SlashCommandInfo.description，缺省为 ""
  - path: string — 资源文件绝对路径（SlashCommandInfo.sourceInfo.path）
  - baseDir: string | undefined — 资源目录（skill 内相对引用的解析基准）

类型不变量：
  - name 非空且不含前导 "/"
  - kind === "skill" ⟹ 原始 SlashCommandInfo.name 形如 "skill:<name>"
  - qualifiedName === `${kind}:${name}`

唯一性：
  - (kind, name) 在一次 listEntries 结果内唯一（上游 loader 已按 name 去重，见 skills.ts:394-427 / resource-loader dedupePrompts）
  - name 单独**不保证**唯一：skill 与 prompt 可同名 → 见 §2.3 消歧

生命周期：每次 listEntries 现算，不持有跨调用状态（对应 E1）

跨模块共享性：跨模块共享 —— consumer = M3 autocomplete、M4 tool
```

### 2.3 标识符与消歧规则

**先证伪一个担心：全局 / 本地同名冲突到不了本插件。** pi 在加载期就按 name 做了 first-wins 去重 —— skills 走 `skillMap`（`skills.ts:410-427`，user 目录先于 project 目录），prompts 走 `dedupePrompts`（`resource-loader.ts:913-936`）；输的那份只留一条 collision 诊断，**从 `getCommands()` 的结果里整个消失**，pi 自己也调不到它。因此：

- `(kind, name)` 在一次 `listEntries()` 内**全局唯一**；
- 需要用**路径**才能区分的情形不存在 —— 路径级标识符是死代码。唯一能让它有意义的做法是绕开 `getCommands()` 自己扫目录，那会建出与 pi 不一致的第二套口径、并让被屏蔽的资源可加载，故不做（登记 TR-5）。

**标识符只有两种形式**：`skill:NAME` 与 `prompt:NAME`。等价输入规则（裁决 D5）：

```
"/workflow"  ==  "workflow"  ==  "skill:workflow"（当 workflow 只属于 skill 时）
```

1. 工具 `query` 接受裸名与限定名，前导 `/` 忽略（`normalizeQuery`）。
2. **只有"唯一且精确同写"才直接加载**（裁决 D7）。判定阶梯：
   ```
   findExact（大小写敏感，裸名或限定名）恰 1 条  → 加载原文
   否则 findExactIgnoringCase ≠ ∅               → 列出全部匹配（≥1 条），不猜
   否则 findFuzzy ≠ ∅                            → 模糊候选
   否则                                          → 全量清单
   ```
   - 依据：pi 的去重 map 是大小写敏感的（`skillMap` / `dedupePrompts` 都以 name 原文为 key），所以 `prompt:Abc` 与 `prompt:abc` **能同时存在**。若匹配时折叠大小写，`prompt:abc` 与 `prompt:Abc` 会返回同一组歧义 —— 而歧义响应正是要模型"用限定名重调"，限定名却消歧不了，构成死循环。实测复现过，不是假想。
   - 第二级刻意用**不敏感**的超集：把所有可能想指的写法都摆出来，让调用方自己挑；不敏感命中恰好 1 条时也只列不加载 —— "唯一 **且** 精确"缺一不可。
   - 不变量：第二级列出的每个限定名，单独回调时必落在第一级唯一命中（测试 `keeps every offered identifier individually loadable` 钉死）。
   - `findFuzzy` 保持大小写不敏感 —— 搜索该宽容，加载才需要严格。
5. **`skill:` / `prompt:` 前缀本身大小写不敏感**（裁决 D8）：前缀是固定关键字，其大小写不携带信息；NAME 部分仍严格。故 `SKILL:abc` ≡ `skill:abc`，而 `skill:Abc` ≢ `skill:abc`。
   - 实现取两种读法的并集（整串当裸名 / 拆前缀后比 kind+name），因此一个名字**字面就叫** `skill:foo` 的 prompt 仍可被 `skill:foo` 找到（连同真的 skill `foo` 一起列出）。
   - 同一前缀规则下推到 `findFuzzy`：带前缀时按 kind 限定范围、用剩余部分搜索（`skill:qp` = 在 skills 里搜 `qp`），搜不到再退回整串搜索。没有这条，句中打 `/skill:qp` 再 Tab 会因为 `:` 参与子序列匹配而必然落空 —— 配合 D1（无命中不回退）就是个死角。
3. 裸名同时被一个 skill 与一个 prompt 持有时 → **不猜**，返回歧义结果，列出两个限定名，要求重调。这是 D2（补全插入裸名）的必然代价。经 D7 后，列出的每个限定名都能唯一解析回来 —— 逃生口是通的。
4. **列表一律打限定名，且不打文件路径**（裁决 D6）。路径只出现在加载成功的响应头里（`path` / `baseDir`，skill 内相对引用需要）。理由不是保密，而是保持"加载 skill/prompt"这条链路可按工具名整体识别：模型没有理由改用通用 read，下游插件（例如做 tool 输出蒸馏的扩展）就能对本工具的输出整体豁免。

---

## 3. 模块划分与功能规约（§3.2）

### M1 `src/registry.ts`

```
函数：listEntries(getCommands: () => SlashCommandInfo[]): SkillRefEntry[]

功能描述：把 pi 的命令清单投影为本插件的资源清单，只保留 SKILL 与 prompt。

前置条件：
  - getCommands 可调用（由调用方在 session_start 之后调用保证，见 H7）

后置条件：
  - 结果 = getCommands() 中 source ∈ {"skill","prompt"} 的全部条目的一一投影，保持原顺序
  - source === "extension" 的条目一条不留（裁决 D3）
  - skill 条目的 name 已剥掉 "skill:" 前缀；剥掉后为空串的条目被丢弃
  - getCommands 抛异常时返回 []（补全路径不得让编辑器崩溃）

副作用：无
```

### M2 `src/match.ts`（纯函数，vitest 覆盖）

```
函数：compileQuery(query: string): RegExp

功能描述：把用户查询编译成"宽松子序列"正则（意图 A3）。

前置条件：无（空串合法）
后置条件：
  - 设 chars = query 中剔除全部 "." 与 "*" 后的字符序列
  - 返回值 ≡ new RegExp(".*" + chars.map(escapeRegex).join(".*") + ".*", "i")
  - chars 为空 ⟹ 返回匹配一切的正则
  - 正则元字符（. * + ? ^ $ { } ( ) | [ ] \）不会造成注入或语法错误
副作用：无

推论（对应 A3 的两个例子）：
  compileQuery("abc")   ≡ /.*a.*b.*c.*/i
  compileQuery("x...a") ≡ /.*x.*a.*/i     （"x..a" 同）
```

```
函数：normalizeQuery(raw: string): string
后置条件：去首尾空白、去全部前导 "/"；其余原样

函数：findExact(entries: SkillRefEntry[], raw: string): SkillRefEntry[]
后置条件：
  - q = normalizeQuery(raw)
  - 返回 { e ∈ entries | lower(e.name) === lower(q) ∨ lower(e.qualifiedName) === lower(q) }，保持 entries 顺序
  - q 为空串 ⟹ 返回 []
副作用：无

函数：findFuzzy(entries: SkillRefEntry[], raw: string, limit: number): SkillRefEntry[]
前置条件：limit ≥ 1
后置条件：
  - q = normalizeQuery(raw)，re = compileQuery(q)
  - 主匹配集 P = { e | re.test(e.name) }；P ≠ ∅ ⟹ 结果取自 P
  - P = ∅ ⟹ 退化匹配集 S = { e | re.test(`${e.name} ${e.description}`) }，结果取自 S
  - 排序：fuzzyMatch(stripWildcards(q), e.name).score 升序（越小越好）；分数相等按 name.length 升序，再按 name 字典序 —— 全序，无平局不确定性
  - |结果| ≤ limit
副作用：无
```

### M3 `src/autocomplete.ts`

```
函数：extractInlineSlashToken(lines, cursorLine, cursorCol, force): { token: string; start: number } | null

功能描述：判定"这是不是一次句中 / + Tab"，并取出待补全 token。

后置条件（判定为 null 的全部情形 —— 每一条都对应一个必须透传的场景）：
  - force !== true                                   → 非 Tab 强制补全（含行首斜杠菜单、打字触发）  [保 P1]
  - 光标前 token 不以 "/" 开头                        → @ 补全 / 普通路径补全                      [保 P4]
  - token 起点左侧全为空白                            → 行首斜杠（含缩进），交还原生菜单            [保 P1]
  非 null 时：
  - token = 当前行 [start, cursorCol) 的子串，start = 从 cursorCol 向左扫到最近的分隔符之后
  - 分隔符集合 = { " ", "\t", '"', "'", "=" }（与上游 PATH_DELIMITERS 一致；"/" 与 ":" 不是分隔符，故 "skill:qp" 是一个 token）
副作用：无
```

```
函数：createSkillRefProvider(current: AutocompleteProvider, getEntries: () => SkillRefEntry[]): AutocompleteProvider

getSuggestions 后置条件：
  - extractInlineSlashToken 为 null ⟹ 返回 current.getSuggestions(...) 的结果，逐字节不变       [I2]
  - 否则 items = findFuzzy(getEntries(), token.slice(1), 50)
      - items 为空 ⟹ 返回 null（裁决 D1：不回退到路径补全，菜单不弹）
      - 否则返回 { prefix: token, items: [{ value: `/${e.name}`, label: `/${e.name}`,
                   description: `${e.kind} · ${e.description}` }] }
  - options.signal 已 abort ⟹ 允许提前返回 null

applyCompletion 后置条件：
  - 同一 (lines, cursorLine, cursorCol) 下 extractInlineSlashToken 为 null ⟹ 委托 current.applyCompletion
  - 否则：新行 = 行[0,start) + item.value + " " + 行[cursorCol,)；cursorCol' = start + item.value.length + 1
  - 不修改 cursorLine，不触及其他行

shouldTriggerFileCompletion：直接委托 current（缺省 true）
triggerCharacters：不设置（上游会过滤 "/"，设了也无效）
副作用：无
```

### M4 `src/tool.ts`

```
工具：try_load_skill_or_prompt
参数：{ query: string; limit?: number（默认 20，钳制到 [1,100]） }

功能描述：名字完全命中就返回该 SKILL / prompt 原文；否则返回宽松模糊搜索的候选。

前置条件：query 为字符串（TypeBox 保证）

后置条件（四分支互斥且穷尽；标识符统一呈现为 `/kind:name`）：
  E1 findExact 恰 1 条 ⟹ content = 单行 `/skill:qpdi loaded successfully from <path>` + 换行 + 文件原文
       —— 不再输出 baseDir 提示：技能内相对引用以什么为基准由该文件自己说了算（通常是 cwd），
          工具替它断言 baseDir 是误导（裁决 D9）
  E2 findExact ≠ 1 且 findExactIgnoringCase ≠ ∅ ⟹ content = 提示 + 全部匹配标识符 + 描述（不含路径）
  E3 上二皆空且 findFuzzy ≠ ∅ ⟹ content = "未精确命中" + 候选表（标识符 + 描述），≤ limit 条
  E4 全空 ⟹ content = "无匹配" + 全量标识符清单（≤ 100 条，超出标注截断数）
  读文件失败（E1 路径）⟹ 抛 Error（含 path 与 errno 消息），由 tool runner 转成错误结果
                        —— AgentToolResult 没有 isError 字段（packages/agent/src/types.ts:355），抛出是唯一的错误通道

结构：resolveQuery(entries, params, read) 为纯函数（read 可注入），registerTryLoadTool 只做装配 —— 分支逻辑因此可脱离磁盘与 pi 实例单测
副作用：只读文件系统（readFileSync 单个已知路径），不写任何状态
不注册 renderResult（对应 E2 教训，避免 details 形状被他插件替换后崩溃）
```

### `index.ts`

```
export default function (pi: ExtensionAPI): void
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.addAutocompleteProvider((current) =>
      createSkillRefProvider(current, () => listEntries(() => pi.getCommands())));
  });
  pi.registerTool(createTryLoadTool(() => listEntries(() => pi.getCommands())));
```

- wrapper 必须在 `session_start` 内注册（H5：`/reload` 会清空 wrapper 数组）。
- `getEntries` 是惰性 thunk，每次调用现取 —— 无缓存即无过期，也不持有句柄（E1）。

---

## 4. 接口规约（§3.3）

```
接口：上游编辑器 → M3
输入：lines / cursorLine / cursorCol / { signal, force }
输出：AutocompleteSuggestions | null
协议约定：
  - 调用方责任：Tab 触发时 force === true 且 explicitTab === true（上游 editor.ts:2156 保证）
  - 被调用方责任：不适用本插件的场景必须原样透传 current 的返回值；返回的 prefix 必须是 lines[cursorLine] 中以 cursorCol 结尾的真子串（上游 applyCompletion 用 cursorCol - prefix.length 定位）

接口：M3/M4 → M1
输入：无
输出：SkillRefEntry[]
协议约定：被调用方保证不抛异常（异常内吞为 []）

接口：M4 → 文件系统
输入：entry.path（绝对路径，来自 pi 自己的 loader）
输出：UTF-8 原文
协议约定：只读；失败转为 isError 结果，不抛出
```

---

## 5. 架构正确性论证（§4.2.1）

### goal → 模块映射

| 目标 | 模块 |
|---|---|
| A1 句中补全 SKILL/prompt | M3（主）+ M1 数据 + M2 筛选 |
| A2 工具兑现引用 | M4（主）+ M1 数据 + M2 匹配 |
| A3 宽松模糊语义 | M2（唯一实现处） |
| P1 行首行为不变 | M3 的 `force !== true` 与"左侧全空白"两条 null 判定 |
| P2 不改上游 | 全部经 `addAutocompleteProvider` / `registerTool` 官方扩展点 |
| P3 资源口径一致 | M1 唯一数据源 `pi.getCommands()` |
| P4 不吃掉别的补全 | M3 的透传分支 |

### 模块协作论证

- **A1 成立**：H1 给出"句中 Tab ⟺ `force===true`"；M3 在该条件下接管，其候选来自 M1（= pi 认可的全部 SKILL/prompt，H3），排序筛选由 M2 按 A3 语义完成；上游在 `prefix.startsWith("/")` 时自动套用斜杠菜单排版（`editor.ts:2131`），故"手感与行首一致"无需额外实现。
- **A2 成立**：M4 用与 M3 同一份 entries 做 `findExact`，命中即读 `sourceInfo.path`（H3 保证该路径就是资源文件本体）返回原文；未命中走 M2 同一套模糊语义。
- **I1（补全能选中的名字，工具必精确命中）成立**：M3 产出的 `item.value = "/" + e.name`；M4 的 `normalizeQuery` 去掉前导 "/" 后得到 `e.name`；`findExact` 以 `lower(name)` 比较，故对同一份 entries 必命中。唯一破口是两次调用之间发生 `/reload` 且该资源被删除 —— 登记为 TR-2。
- **I2（不影响既有行为）成立**：M3 的 `getSuggestions`/`applyCompletion` 在 `extractInlineSlashToken === null` 时是对 `current` 的恒等委托；该判定只读入参、无状态，故非本插件场景下 provider 链的输入输出与未安装时逐字节相同。

### 关键假设

- H1–H6：见 `principles.md` §2（均已在源码中定位到行号）。
- **H7**：`pi.getCommands()` 只在 `session_start` 之后被调用（补全与工具执行都晚于会话建立），此时 `bindCore` 已完成绑定（`agent-session.ts:2340`）。违反即抛异常 → 被 M1 内吞为 `[]`（降级为"无候选"，不崩）。
- **H8**：`SlashCommandInfo.sourceInfo.path` 对 skill 指向 `SKILL.md` 本体、对 prompt 指向模板文件本体（`skills.ts:315` / `prompt-templates.ts:17`）。若上游改为指向目录，E1 分支读文件会失败 → 走 isError，不静默给错内容。

### 模块级不变量

- **I1** 名字口径一致（论证见上）—— 维护方：M1 产出唯一口径，M3/M4 均不得自行改写 name。
- **I2** 非本插件场景零影响 —— 维护方：M3。
- **I3** 无长生命周期句柄 —— 维护方：全部模块（禁用 setInterval / spawn / fs.watch）。

---

## 6. 已接受的权衡（known-state）

| 编号 | 内容 | 来源 | 重审条件 |
|---|---|---|---|
| TR-1 | 句中 Tab 不再能补全文件路径（0 命中即空菜单） | 用户裁决 D1 | 用户反馈句中补路径的需求回潮 |
| TR-2 | `/reload` 恰好发生在"补全插入"与"工具调用"之间时，I1 可能失效（工具落到 E3/E4 分支给候选） | 无缓存设计的固有窗口 | 出现实际误导案例 |
| TR-3 | 每次 Tab 都重新调用 `getCommands()`（无缓存） | 规模在数十条量级，纯内存映射 | 资源数量级增长到数千条 |
| AR-1 | skill 与 prompt 同名时，补全插入的 `/foo` 本身有歧义，需工具多一轮交互消歧 | 裁决 D2 的直接后果 | 若实际使用中频繁撞名 |
| TR-5 | 被 pi 的 first-wins 去重屏蔽掉的同名资源（如项目级同名 skill）本插件也加载不了 | P3 口径一致：只认 `getCommands()` | 上游改为暴露被屏蔽资源 |
| TR-6 | 候选列表不给文件路径，模型无法直接 read 绕过本工具 | 裁决 D6（保持加载链路可按工具名识别） | 出现确需路径的场景 |
| AR-2 | 选中行中被本插件着色的一小段之后，前景色恢复终端默认而非 accent（§7.1） | SelectList 整行包裹式着色的固有限制 | 上游给 SelectList 加分段着色能力 |
| TR-4 | 输入框正文不着色（§7.2） | A4 的"不付高耦合代价"约束 | 用户明确要求，且接受编辑器组件互斥 |

---

## 7. 着色（A4）

分两处，代价差一个数量级。

### 7.1 补全菜单着色 —— 纳入 MVP

- `SelectList.renderItem`（`select-list.ts:138-175`）把 `item.label` 送进 `truncatePrimary`、把 `item.description` 送进 `theme.description(...)`；两者的宽度计算都经 `visibleWidth` / `truncateToWidth`，**均为 ANSI-aware**（H9）。因此可以直接在 label / description 里内嵌颜色。
- 做法：`label = colorize("/") + name`（`/` 用 `theme.fg("accent", …)`），`description = tag + " " + 原描述`，其中 `tag` 为 `skill` / `prompt` 两种不同颜色的标记。颜色取自 `ctx.ui.theme`，跟随用户主题。
- **收尾用 `\x1b[39m` 而非 `\x1b[0m`**（H9）：选中行整行被 `theme.fg("accent", …)` 包裹，用全量 reset 会把该行剩余部分的选中色也清掉。
- 残留瑕疵（登记 AR-2）：选中行内被我们着色的那一小段之后，前景色恢复为终端默认而非 accent。视觉上是"选中行里 `/` 之后颜色略淡"，不影响可用性。

### 7.2 输入框正文着色 —— **不纳入 MVP**，列为可选 Phase 2

- 事实（H10）：编辑器正文无着色钩子，`EditorTheme` 只有 `borderColor` + `selectList`。
- 唯一途径：`ctx.ui.setEditorComponent((tui, theme, kb) => new ColorizedEditor(...))`，子类覆盖 `render(width)`，对 `super.render(width)` 的返回行做后处理，把 `/<已知资源名>` 替换为着色版本。ANSI 零宽，padding 在 super 内已算完，故宽度不受影响。
- 代价：(a) 编辑器 factory 全局唯一，与任何同样换编辑器的插件互斥；(b) 需绕开光标反显序列（`\x1b[7m…\x1b[0m`）与 `CURSOR_MARKER`，否则会撕裂光标渲染；(c) 强依赖上游 `render()` 的输出格式，上游一改即失效。
- 结论：与 A4 的"不得付出高耦合代价"直接冲突，故默认不做。若用户明确要，作为独立开关（默认 off）单独实现，不与 §3 的四个模块耦合。

## 8. 测试计划（/workflow §5.3）

**单元（vitest，`src/match.test.ts` + `src/registry.test.ts` + `src/autocomplete.test.ts`）**

1. `compileQuery`：`"abc"` 命中 `qpdi-abc`/`a-b-c` 不命中 `acb`；`"x...a"` 与 `"x..a"` 等价；空串匹配一切；`"c++"`、`"a("`、`"[b]"` 不抛异常且按字面匹配。
2. `findExact`：`foo` / `/foo` / `skill:foo` / `SKILL:FOO` 四种写法；同名 skill+prompt 返回 2 条；空串返回 0 条。
2c. 前缀（D8）：`PROMPT:Abc` / `Skill:abc` 命中，`SKILL:Abc` 与 `skill:WORKFLOW` 不命中；`SKILL:wkf` 的模糊搜索只在 skills 内进行；名字字面为 `skill:foo` 的 prompt 不被前缀读法吞掉。
2b. 大小写阶梯（D7）：`skill:abc`+`prompt:Abc`+`prompt:abc` 共存时 —— `Abc` / `prompt:abc` / `prompt:Abc` / `skill:abc` 各自唯一加载；`abc` 与 `ABC` 都列出全部 3 条；只差大小写的唯一命中只列不加载；列出的每个限定名单独回调必唯一命中。
3. `findFuzzy`：主匹配非空时不掺入描述匹配项；主匹配为空时才退化；排序全序稳定；`limit` 生效。
4. `listEntries`：过滤 extension；剥 `skill:` 前缀；`getCommands` 抛错 → `[]`。
5. `extractInlineSlashToken`：`force=false` 恒为 null；`"hello /qp"` 命中；`"/qp"`、`"   /qp"` 为 null；`"@src/ a"` 为 null；`'say "/qp'` 命中（引号是分隔符）；`"/skill:qp"` 整体为一个 token。
6. `applyCompletion`：句中插入结果与光标位置；透传场景确实调到 `current`（spy）。
7. 着色（§7.1）：带 ANSI 的 description 经 `visibleWidth` 计算出的宽度 === 无 ANSI 版本；着色片段以 `\x1b[39m` 收尾、不含 `\x1b[0m`；无 theme 时退化为纯文本。
8. `resolveQuery` 四分支：裸名命中 / 限定名命中 / 撞名歧义 / 模糊候选 / 全无匹配 / 空 registry；读文件失败必须抛出而非静默；列表不含 `.md` 路径（D6）；limit 钳制。

**运行方式**：仓库根目录未安装 vitest（只在 `packages/*/node_modules` 下），故本插件用 `node:test` + tsx：

```bash
node --import tsx --test my-plugins/skill-ref/src/*.test.ts
```

**手工验证（TUI，实现完成后逐条跑）**

- 句首 `/` + Tab → 原生菜单，内容与安装前一致（P1）
- 句中 `帮我按 /qp` + Tab → 出 skill/prompt 菜单；继续打字收窄；回车后文本为 `帮我按 /qpdi `
- 句中 `/zzzz` + Tab → 无菜单、无文件路径（D1）
- `@` 补全、`/model ` 参数补全不受影响（P4）
- `/reload` 后功能仍在（H5）
- `try_load_skill_or_prompt`：精确名、模糊名、同名、乱码四种输入
- `pi -p "hi"` 正常退出（E1 / I3）
