# skill-ref — 调研报告（/workflow §4.1）

范围：句中 `/` + Tab 补全 SKILL / prompt（需求 1）、`try_load_skill_or_prompt` 工具（需求 2）。
结论先行：**两条需求都能在纯扩展层实现，不需要动上游包**；共约 350–450 行 TypeScript。

---

## 1. 本项目已有的相关基础设施

### 1.1 补全协议（`packages/tui/src/autocomplete.ts`）

```ts
interface AutocompleteProvider {
  triggerCharacters?: string[];
  getSuggestions(lines, cursorLine, cursorCol, { signal, force }): Promise<AutocompleteSuggestions | null>;
  applyCompletion(lines, cursorLine, cursorCol, item, prefix): { lines, cursorLine, cursorCol };
  shouldTriggerFileCompletion?(lines, cursorLine, cursorCol): boolean;
}
interface AutocompleteSuggestions { items: AutocompleteItem[]; prefix: string }
interface AutocompleteItem { value: string; label: string; description?: string }
```

内置实现 `CombinedAutocompleteProvider` 的分派顺序（`autocomplete.ts:284-373`）：

1. `@` 前缀 → fd 模糊文件搜索；
2. `!force && textBeforeCursor.startsWith("/")` → 行首斜杠命令 / 命令参数补全；
3. 其余 → `extractPathPrefix(text, force)` → `getFileSuggestions()` 目录列举。

**当前痛点定位**：句中 `/` + Tab 落在第 3 条。`extractPathPrefix` 在 `force=true` 时无条件返回光标前 token（即 `"/"` 或 `"/ab"`），`getFileSuggestions` 把它当绝对路径 → 列出文件系统根目录内容。这就是需求 1 要替换掉的行为。

### 1.2 Tab 键的两条路径（`packages/tui/src/components/editor.ts:2139-2158`）

```ts
private handleTabCompletion(): void {
  if (this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" "))
    this.handleSlashCommandCompletion();   // force=false, explicitTab=true
  else
    this.forceFileAutocomplete(true);      // force=true,  explicitTab=true
}
// isInSlashCommandContext = isSlashMenuAllowed() && textBeforeCursor.trimStart().startsWith("/")
```

要点三条：

- **句首 vs 句中在协议层可辨识**：`force === true` ⟺ 不是行首斜杠上下文。据此拦截即可天然满足 P1（行首行为不变）。
- `/` **不能**注册为 `triggerCharacters`（`editor.ts:2214-2225` 显式过滤 `/`），所以句中只能靠 Tab 触发——与用户需求表述一致。
- `force && explicitTab && items.length === 1` 时编辑器直接 apply，不弹菜单（`editor.ts:2266`）。
- `prefix.startsWith("/")` 时菜单自动使用斜杠命令的排版（`editor.ts:2131`），所以观感与行首菜单一致，无需额外工作。

### 1.3 扩展点（`packages/coding-agent/src/core/extensions/types.ts`）

| 能力 | API | 位置 |
|---|---|---|
| 叠加补全 provider | `ctx.ui.addAutocompleteProvider((current) => provider)` | `types.ts:223`；装配 `interactive-mode.ts:625-640` |
| 注册工具 | `pi.registerTool(ToolDefinition)`（TypeBox 参数 schema） | `types.ts:1225` / `498` |
| 取 SKILL/prompt 清单 | `pi.getCommands(): SlashCommandInfo[]` | `types.ts:1315`；实现 `agent-session.ts:2315-2338` |

`SlashCommandInfo = { name, description?, source: "extension"|"prompt"|"skill", sourceInfo }`，
`SourceInfo = { path, source, scope: "user"|"project"|"temporary", origin, baseDir? }`。

- skill 的 `name` 是 `skill:<name>`，`sourceInfo.path` 指向 `SKILL.md`，`baseDir` 是 skill 目录；
- prompt 的 `name` 是模板名，`sourceInfo.path` 指向模板文件；
- 覆盖范围 = pi 自己的标准路径（`~/.pi/agent/skills`、`<cwd>/.pi/skills`、prompts 同构，外加包 / 插件通过 `resources_discover` 贡献的路径），并随 `/reload` 刷新。**用它就等于满足 P3，不必自己扫目录。**

### 1.4 模糊匹配（`packages/tui/src/fuzzy.ts`，从 `@earendil-works/pi-tui` 导出）

`fuzzyMatch(query, text)` 已是子序列匹配（字符按序出现即命中）+ 打分（连续命中、词边界加分，间隔扣分）。
局限两点：`.` 与 `*` 被当字面量；`fuzzyFilter` 按 `[\s/]+` 拆 token。因此它可以承担**排序**，但不能直接承担需求 2 里 `/x...a` 的通配语义。

### 1.5 参考实现与规约

- `examples/extensions/github-issue-autocomplete.ts` — 补全 wrapper 的官方范式：命中自己的 token 就接管，否则 `return current.getSuggestions(...)`；`applyCompletion` 委托给 `current`。
- `examples/extensions/dynamic-tools.ts` — `registerTool` + TypeBox 范式。
- `my-plugins/CONVENTIONS.md` — G1 句柄泄漏（本插件不引入定时器/子进程，天然规避）、`renderResult` 的 `details` 运行时形状校验要求。
- `my-plugins/save-msg/save-msg.test.ts` — 纯函数用 vitest 单测的既有范式。

### 1.6 一个必须遵守的时序约束

`interactive-mode.ts:1953` 在 `/reload` 时清空 `autocompleteProviderWrappers`。因此 wrapper **必须在 `session_start` 里注册**（工具注册同理），否则 reload 后功能消失。

---

## 2. 方案对比

### 2.1 需求 1：句中 `/` + Tab 的接管方式

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 补全 wrapper（推荐）** | `addAutocompleteProvider`，在 `force===true` 且光标前 token 以 `/` 开头时接管 | 官方扩展点；不碰上游（P2）；行首路径根本不进入本分支（P1）；未命中可透传（P4）。约 120 行 |
| B. 自定义编辑器 | `setEditorComponent` 继承 `CustomEditor` 拦截 Tab | 需复刻编辑器键位与补全状态机；侵入面大幅超出需求。**弃** |
| C. 改内置 provider | 直接改 `packages/tui/src/autocomplete.ts` | 违反 P2；也不是"插件"。**弃** |

### 2.2 需求 2：模糊匹配语义

用户给的语义：`/abc` → `.*a.*b.*c.*`；`/x...a`、`/x..a` → `.*x.*a.*`（`.` 是"任意若干字符"的占位，而非字面点号）。

| 方案 | 做法 | 评价 |
|---|---|---|
| A. 直接用 `fuzzyFilter` | 复用 pi-tui | 子序列语义对了，但 `.`/`*` 被当字面量、`/` 被当分隔符 → 不满足 A3 |
| **B. 通配符编译为正则（推荐）** | 把查询中连续的 `.`/`*` 折叠成 `.*`，其余字符转义后以 `.*` 连接，首尾补 `.*`，`i` 标志 | 精确覆盖用户描述的两种写法；实现 ~15 行，可完全单测 |
| C. 引入 fzf/fuse 依赖 | 第三方库 | 为 15 行逻辑引入依赖，违反最小变更 |

**推荐 B 做筛选 + 复用 `fuzzyMatch` 做排序**（去掉通配符后的查询串喂给 `fuzzyMatch` 取分数；分数不可用时按 `source` 与名称长度稳定排序）。

### 2.3 两处共用同一套语义（对应 R3）

补全 UI 与工具共享同一个 `registry`（`getCommands()` 过滤 `source ∈ {skill, prompt}`）和同一个 `match` 模块。这条是不变量：**在补全菜单里能选中的名字，工具必然能精确命中**。

---

## 3. 推荐方案（MVP）

### 3.1 目录

```
my-plugins/skill-ref/
  package.json          # { "pi": { "extensions": ["index.ts"] } }
  index.ts              # session_start 里注册 wrapper + 工具
  src/registry.ts       # getCommands() → SkillRefEntry[]（只留 skill/prompt）
  src/match.ts          # 通配符编译、精确匹配、模糊筛选+排序（纯函数）
  src/autocomplete.ts   # AutocompleteProvider wrapper
  src/tool.ts           # try_load_skill_or_prompt
  src/match.test.ts     # vitest 单测（纯函数层）
  README.md
  docs/design/{principles,research}.md
```

### 3.2 需求 1 行为规约

- **触发**：`options.force === true`（即句中 Tab）**且** 光标前 token 以 `/` 开头 **且** token 起点之前存在非空白字符。否则 `return current.getSuggestions(...)`。
- **token 边界**：沿用内置的分隔符集合（空格 / Tab / `"` / `'` / `=`）向左扫；token 内部允许 `/` 与 `:`（`/skill:qp` 是一个 token）。
- **候选**：`registry` 全量 → 用 token 去掉首 `/` 后的部分做模糊筛选（同 2.2 语义）→ `label = /skill:foo` 或 `/promptname`，`description = 来源标记 + 原描述`。
- **落选回退**：0 条命中时 `return current.getSuggestions(...)`，保住原有路径补全（**待裁决项 D1**）。
- **插入**：`applyCompletion` 在识别出是本插件的场景时，把整个 token 替换为 `"/" + name + " "`；其余场景委托 `current`。
- **不做**：不注册 `triggerCharacters`（`/` 本来就被上游过滤）；不改行首行为。

### 3.3 需求 2 工具规约

```
name: try_load_skill_or_prompt
params: { query: string, limit?: number = 20 }
```

1. 归一化 `query`：去首尾空白、去前导 `/`。
2. **精确命中**（大小写不敏感，`foo` / `skill:foo` 两种写法都算命中同一个 skill）→ 读 `sourceInfo.path` 原文返回，附带 `path` 与 `baseDir`（skill 内相对引用需要它）。
3. **未精确命中** → 按 2.2 语义模糊筛选（先匹配名字；名字 0 条时再匹配名字+描述）→ 返回候选表：`name / source / description / path`，截断到 `limit`。
4. **0 条** → 返回"无匹配"+ 全量名称清单（截断），让模型能再试。
5. **用户可见渲染与模型 content 分离**：折叠态只显示一行；成功时包含限定名、来源路径与原文字符数（读取后字符串的 `content.length`），失败时只附候选数量；展开态显示原始 content。渲染不得删改模型 content，`details` 使用前必须做运行时形状校验。

### 3.4 正确性关注点（进入架构阶段要展开的）

- I1：补全菜单里出现的每个 `name`，工具都能精确命中（同源同语义）。
- I2：`force === false` 的任何调用路径行为与未安装本插件时逐字节相同（P1/P4）。
- I3：无长生命周期句柄（E1）。
- I4：折叠态不暴露正文或候选明细；模型仍收到完整 content，且 `try_load_skill_or_prompt` 在全局 impression 配置中 passthrough。

### 3.5 验证方式

- 单测（vitest）：`match.ts` 的通配语义（`abc` / `x...a` / 空串 / 正则元字符 `+` `(` 等注入）、精确匹配的两种写法、排序稳定性。
- 手工验证（TUI）：句首 `/` + Tab 不变；句中 `hello /qp` + Tab 出 skill 列表；选中后文本形态；折叠 tool result 仅一行状态，展开后恢复原始内容；`@` 补全不受影响；`/reload` 后仍生效；`pi -p` 能正常退出。

---

## 4. 用户裁决（2026-07-27 已确认）

- **D1｜无命中时不回退**：0 条命中即返回 `null`（菜单不弹出），不落回文件路径补全。
  → 影响 §3.2 的"落选回退"条：改为不回退。`@` 补全与"token 不以 `/` 开头"的 Tab 补全不受影响。
- **D2｜插入 `/foo `**（不带 `skill:` 前缀），skill 与 prompt 一视同仁。
  → 引入 **同名歧义**（skill `foo` 与 prompt `foo` 并存）。消歧规则见架构文档 §2.3：工具在精确命中多于一条时返回歧义提示 + 限定名（`skill:foo` / `prompt:foo`），并接受限定名作为输入。
- **D3｜候选只含 SKILL + prompt**，排除 `source === "extension"`。
- **D4｜插件名 `skill-ref`**，目录 `my-plugins/skill-ref/`。
- **D5｜标识符只有 `skill:NAME` / `prompt:NAME` 两种形式**，不引入路径级标识符。等价输入：`/workflow` ≡ `workflow` ≡ `skill:workflow`（该名字不撞名时）。
  → 依据：pi 已在加载期按 name first-wins 去重，`(kind, name)` 全局唯一，路径级标识符是死代码（架构 §2.3）。
  → 不加 `kind` 参数：限定名已经把种类编进 query，多一个参数只是多一处可填错的地方。
- **D7｜只有"唯一且精确同写"才直接返回原文；其他任何情况一律返回大小写不敏感的全部匹配对象**。
  → 起因：`skill:abc` + `prompt:Abc` + `prompt:abc` 可以同时存在（pi 的去重 map 大小写敏感）。原先匹配时折叠大小写，`prompt:abc` 与 `prompt:Abc` 返回同一组歧义 —— 而歧义响应正是要模型"用限定名重调"，于是死循环。已实测复现并修复。
  → 三资源共存时的实测结果：`abc` → 列出 3 条；`Abc` → 加载 `prompt:Abc`；`prompt:abc` / `prompt:Abc` / `skill:abc` → 各自加载；`ABC` → 列出 3 条。
  → 顺带定死：只差大小写的唯一命中也**只列不加载**（"唯一"与"精确"缺一不可），代价是打错大小写多一轮调用，换来"自动加载"永不猜测。
- **D9｜加载成功只回一行头**：`/skill:qpdi loaded successfully from <path>`，随后直接是原文。
  → 删掉原先的 `baseDir: … (resolve relative references against it)` —— 相对引用以什么为基准由被加载文件自己决定（通常是 `.`），工具替它断言是误导。
  → 标识符在四个分支里统一呈现为 `/kind:name`。
- **D8｜`skill:` / `prompt:` 前缀大小写不敏感**（NAME 部分仍严格）。顺带修掉一个死角：`findFuzzy` 现在也认前缀并按 kind 限定范围，否则句中打 `/skill:qp` + Tab 会因 `:` 参与子序列匹配而永远空菜单。
- **D6｜候选/歧义列表只打限定名，不打文件路径**；路径仅出现在加载成功的响应头（`path` / `baseDir`）。
  → 目的：保持"加载 skill/prompt"是一条可按工具名识别的链路，模型不会改用通用 read 绕过去，下游插件（如做 tool 输出蒸馏的扩展）可对本工具整体豁免。
- **D10｜折叠态用户可见输出固定为一行状态**（2026-07-30 确认，后续补充成功定位信息）：成功显示 `/<kind:name> loaded successfully from <path> — <N> chars`，其中 N 是原文 `content.length`；失败只表达 not loaded 与候选数量，不打印正文、候选名称或其他明细；展开态仍显示原始 content。
  → 该要求已升格到 `principles.md` A5/P5/R5。实现必须通过 `renderResult` 分离 TUI 展示与模型 content，并对 `details` 做运行时形状校验。
- **D11｜模型内容不因展示精简而改变**（2026-07-30 确认）：`execute` 的完整 content 保持现状；全局 impression 将 `try_load_skill_or_prompt` 配置为自动 passthrough，不做 distill。
