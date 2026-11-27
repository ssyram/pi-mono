# skill-ref — 动态加载：调研与设计

> 上游：`principles.md`（P2 不改上游 / P3 只认 `getCommands()` / I3 无长生命周期句柄是硬边界）、`architecture.md`（M1/M3/M4、TR-3、TR-5）。
> 状态：**已按 §3.1 的 Path B（第二个 DefaultResourceLoader）+ 校准守卫实施**，2026-11-26；实施记录见 §6。用户裁决：不改上游；可见行为与原状一致，只增加动态刷新；变化时右上角英文标识。

---

## 0. 结论

`/models` 的"缓存 + 异步刷新 + 就地更新 + 保留指针"**不能照搬**，原因不是实现难度，而是两者的数据源不同类：`/models` 刷新的是网络目录（真有 I/O 可异步），skill-ref 的数据源 `pi.getCommands()` 已经是内存快照（无 I/O 可异步），且在两次 `session_start` 之间**不可变**（H12）。

由此得到三条判断：

1. 你列的五项要求中四项**现状已满足**：即时出菜单、筛选永不阻塞、方向键不重查所以指针不跳、`try_load` 每次现读。
2. 唯一真实差距是**会话中新增/删除的 skill 不 `/reload` 看不到**。这项在 P2 + P3 下无解；要解，需要上游加 4 处最小改动（§3.3），插件侧再加一个 `EntryStore`（§3.4）。
3. 推荐暂不推进，把触发条件写清（D12）。

---

## 1. 调研

### 1.1 当前实现：每次现算，但数据源本身已是内存快照

```
index.ts      getEntries = () => listEntries(() => pi.getCommands())      惰性 thunk
registry.ts   listEntries   过滤 source ∈ {skill, prompt}，投影为 SkillRefEntry[]
```

`AgentSession.getCommands()`（`agent-session.ts:3532-3552`）= `runner.getRegisteredCommands()` + `this.promptTemplates` + `this._resourceLoader.getSkills().skills` 三段 map 后 spread。`getSkills()` 直接返回 `this.skills`（`resource-loader.ts:469`），无任何文件读取。

**H12（新）｜`resources_discover` 完成之后、下一次 reload 之前，`getCommands()` 输出不可变。** 证据：
- `_resourceLoader.reload()` 全仓唯一调用点是 `AgentSession.reload()`（`agent-session.ts:3854`）；
- `skills` 只在 `updateSkillsFromPaths` 内整体赋值（`resource-loader.ts:901`），该方法只被 `reload()` 调用；
- `promptTemplates` 是只读 getter（`agent-session.ts:1770`）；
- `reload` / `newSession` / `switchSession` / `fork` 都会触发 `session_start`，插件此时重建。
- **例外窗口**（实施时真机复现）：`bindExtensions` 先 `emit(session_start)`、再 `extendResourcesFromExtensions`（`agent-session.ts:3450-3452`），扩展经 `resources_discover` 注册的资源（source `extension:index`）在 session_start 那一刻还不在 `getCommands()` 里——同步读是 50 条，重扫结算时已是 52 条。

推论：会话内"刷新"拿不到任何新数据；"缓存"与"现算"在正确性上**等价**，差别只是每次按键多几层对象分配。TR-3 已裁决数十条量级不需要缓存，重审条件（数千条）未到。

### 1.2 `/models` 的刷新为什么是异步的

`ModelSelectorComponent`（`model-selector.ts`）是 **overlay 组件**，自持渲染循环：

- 构造：`loadModelsFromSnapshot()` 同步读 `modelRuntime.getAvailableSnapshot()` → 立即渲染；
- 后台：`await refreshModelCatalogs(modelRuntime, signal)` —— **网络 I/O，拉 provider 目录**，这是异步的唯一理由；15s 超时 + AbortController + `closed` 标志；
- 完成：刷新前抓 `filteredModels[selectedIndex].model`，刷新后 `filterModels(query, preferredModel)` 用 `modelsAreEqual` **按身份重锚**选中项，找不到再 clamp；
- 失败：保留快照，状态行提示 "showing cached models"。

### 1.3 编辑器 inline autocomplete 是拉模型 —— 三点硬约束

skill-ref 的菜单不是 overlay，是编辑器内联补全，`provider` 只供 items，状态归编辑器（`packages/tui/src/components/editor.ts`）：

| # | 约束 | 位置 | 后果 |
|---|---|---|---|
| C1 | 只在文本/光标变化或 Tab 时重查；`updateAutocomplete` 是 private；provider 没有"我变了，重查我"的入口；`ctx.ui` 也没有 | `editor.ts:2491`、`types.ts` UIContext | "就地刷新"需要上游开推送口 |
| C2 | 每次重查 `createAutocompleteList` 新建 `SelectList`，选中项 = `getBestAutocompleteMatchIndex`（精确 > 首个前缀匹配 > 0），**不按 value 保留** | `editor.ts:2455-2463`、`2240-2258` | "保留指针"需要上游在重查路径上按 value 重锚 |
| C3 | `isAutocompleteRequestCurrent` 用 requestId + 文本/光标快照过滤过期响应 | `editor.ts:2436-2452` | 刷新完成时若用户已打字，过期结果天然被丢弃（现成保障） |

两条推论：

- C1 + C2 都不是插件能绕开的（P2）。
- **反过来，当前没有推送口，所以也不存在"刷新后指针跳 top"**：方向键只走 `SelectList.handleInput`，不重查；每次重查都是查询串变了，此时重排到最佳匹配是期望行为。你描述的"跳来跳去"在当前实现里**不会发生**，它只会出现在"查询没变但 items 变了"的场景——那正是推送刷新才会引入的场景。

### 1.4 pi 没有轻量重扫

- `ResourceLoader.reload()`（`resource-loader.ts:549-646`）是单体：settings → `packageManager.resolve()` → 加载**全部扩展** → 才算 skills/prompts/themes。
- 对扩展的连带效应：`/reload` → 重跑 `session_start`（重注册 provider）→ `setAutocompleteProvider` → `cancelAutocomplete()` **关掉正在开的菜单**（`editor.ts:423-426`）。与"就地刷新"目标相反。
- pi 没有 skill 目录 watcher（仅 `footer-data-provider.ts` 的 git 文件 watch）。
- 公开导出了 `loadSkills({ cwd, agentDir, skillPaths, includeDefaults })`（`index.ts:333`），但只覆盖默认目录：**不含** settings 配置路径、**不含** package 提供的 skill、**绕开** first-wins 去重的另一半。插件拿它自扫 = 正是 TR-5 否决的"第二套口径"（会让被 pi 屏蔽的资源在本插件里复活，且 R3 两处口径不再同源）。

---

## 2. 需求逐项对照

| 你的要求 | 现状 | 差距 | 根因 |
|---|---|---|---|
| 默认读缓存（即时出菜单） | **已满足**：数据源是内存快照，同步返回 | 无 | — |
| 进行异步更新 | **无可更新之物** | 会话内数据不可变 | H12；pi 只在 reload 时重扫 |
| 更新完就地刷新 + 保留指针 | **无推送口**；但也**无跳 top 问题** | 需上游 `refreshAutocomplete` + 按 value 重锚 | §1.3 C1/C2 |
| 没更新完就继续筛选 | **已满足**：筛选同步、永不阻塞 | 无 | — |
| `try_load` 同样处理 | **已满足**：`execute` 每次现读 | 仅"新 skill 不 reload 也查得到"做不到 | 同第 2 行 |

**真正的、唯一的差距**：会话中新增/删除的 skill 要 `/reload` 才可见。

---

## 3. 设计

### 3.1 方案空间

| 方案 | 做法 | 判定 |
|---|---|---|
| **S0 维持现状** | 惰性 thunk，每次现算 | **默认推荐**：四项已满足、零风险、零新代码 |
| S1 插件内 `loadSkills()` 自扫 | 后台调 pi 导出的 `loadSkills`，与 `getCommands()` 合并 | **否决**：违反 P3 / TR-5（漏 settings 路径与 package skill、复活被屏蔽资源、第二套口径） |
| S2 用户命令触发 `ctx.reload()` | 加 `/skill-ref-refresh` | **无价值**：等价 `/reload`，且关菜单、重启全部扩展 |
| S3 overlay 菜单（字面照搬 `/models`） | `ctx.ui.custom` 自绘 | **否决**：丢失"句中 + 打字即筛选"的核心交互（A1），与行首手感不一致 |
| **S4 上游 4 处最小 API + 插件 `EntryStore`** | §3.2–3.6 | **Decisional**：唯一能兑现全部五项的路径；需突破 P2 |

### 3.2 S4 总览（若裁决推进）

```
session_start
  └─ store = createEntryStore(read = () => listEntries(() => pi.getCommands()),
                              rescan = () => pi.refreshCommands())
     store.snapshot()  ← 同步，首次即 listEntries 结果，lastRefreshAt = now

getSuggestions（每次按键）
  ├─ items = findFuzzy(store.snapshot(), q)
  ├─ store.maybeRefresh({ ttl: 30s })     ← 惰性触发，single-flight，不 await
  └─ return items                          ← 永不等待；signal.aborted 时照旧返回 null

refresh resolve
  └─ store.entries = 新快照；generation++
  └─ ctx.ui.refreshAutocomplete()          ← 编辑器：菜单开着 → 同 text/cursor 重查并按 value 重锚；关着 → no-op

try_load execute
  └─ entries = await store.refreshOrSnapshot({ timeoutMs: 500 })   ← 新鲜者胜，超时退回快照
     resolveQuery(entries, params)                                   ← M4 其余不变
```

### 3.3 上游改动清单（S4 的前提，4 处，估 ~60 行）

**U1 `ResourceLoader.reloadResources()`**（`resource-loader.ts`）
- 复用 `lastSkillPaths` / `lastPromptPaths` 调 `updateSkillsFromPaths` / `updatePromptsFromPaths`；不碰 settings、packageManager、extensions。
- 不重跑 `session_start`，不清 autocomplete wrapper，菜单不关。
- 边界：不发现新安装的 package（那本来就要 reload，package 会带扩展）。

**U2 `AgentSession.refreshCommands()` → `pi.refreshCommands(): Promise<void>`**（`agent-session.ts` bindCore、`types.ts` ExtensionAPI）
- `await this._resourceLoader.reloadResources()`；之后 `getCommands()` 返回新集合。

**U3 `Editor.refreshAutocomplete()`**（`tui/src/components/editor.ts`）
- public；`if (!this.autocompleteState) return;`
- 直接走 `startAutocompleteRequest`（绕过 debounce），`options` 增 `preserveSelection: true`。
- `applyAutocompleteSuggestions`：新建 list 前记 `keep = this.autocompleteList?.getSelectedItem()?.value`；之后若 `preserveSelection && keep`，`items.findIndex(it => it.value === keep)` ≥ 0 则 `setSelectedIndex`，否则维持现有 best-match 规则（选中项被删时退回最佳匹配是合理退化）。
- `isAutocompleteRequestCurrent` 不动：text/cursor 未变才应用。
- `setAutocompleteProvider` 仍 `cancelAutocomplete()`，不受影响。

**U4 `ctx.ui.refreshAutocomplete()`**（`types.ts` UIContext + runner 绑定）
- 转调 U3。

### 3.4 插件改动（S4）

新文件 `src/entry-store.ts`（一个概念，~60 行，替代 `index.ts` 里的 thunk）：

```ts
export interface EntryStore {
  /** 同步、不抛、O(1)、零分配。 */
  snapshot(): SkillRefEntry[];
  /** single-flight；resolve 时快照已更新。失败保留旧快照、不抛（H7 同款降级）。 */
  refresh(): Promise<void>;
  /** 距上次刷新超过 ttl 才后台刷新；不等待、不抛。 */
  maybeRefresh(ttlMs: number): void;
  /** 工具侧：新鲜者胜；超时/失败退回快照。 */
  refreshOrSnapshot(timeoutMs: number): Promise<SkillRefEntry[]>;
}
export function createEntryStore(read: () => SkillRefEntry[], rescan: () => Promise<void>): EntryStore;
```

内部：`entries`、`inFlight: Promise<void> | undefined`、`lastRefreshAt`。全部在 `session_start` 闭包内创建 → **会话作用域**，无跨会话全局（AGENTS.md 扩展规则）。超时用 `AbortSignal.timeout(ms)`，无 handle 泄漏（I3）。`read` 继续包 try/catch → `[]`（H7）。

接线：
- `autocomplete.ts`：`getSuggestions` 改用 `store.snapshot()` + `store.maybeRefresh(TTL)`；`refresh()` resolve 后调 `ctx.ui.refreshAutocomplete()`（provider 工厂在 `session_start` 作用域内，能拿到 `ctx.ui`）。
- `tool.ts`：`execute` 改 `resolveQuery(await store.refreshOrSnapshot(500), params)`；`LoadDetails` 加 `stale: boolean`，折叠态不打、仅供排查。
- `transform-references.ts`：用 `store.snapshot()`（发送时不再刷新，菜单阶段已刷过）。
- `index.ts`：`getEntries` thunk → `store`；文件头注释"read pi's command list on every use"改为引用本文件。

### 3.5 效率与正确性论证

- **热路径**：`snapshot()` O(1) 零分配；现状每次按键 3 层 map + spread + 过滤，数十条量级无感，但 S4 顺手消掉。
- **刷新频率**：TTL + single-flight → 每 TTL 窗口至多一次磁盘扫描；扫描 = `loadSkills` 读 N 个 SKILL.md（数十条 ≈ 数十 ms），有超时上限。
- **I3**：TTL 是惰性比较不是 `setInterval`；无 watcher；`pi -p` 退出不受影响。
- **I1**（菜单能选中的名字工具必命中）：菜单与工具共用 `store` 同一 generation；工具刷新成功则菜单下一次按键也已是新快照。TR-2 的窗口从"`/reload` 恰好发生"缩到"刷新恰好删掉了该名"，且工具落到 E3/E4 给候选，不静默。
- **指针不跳**：U3 按 value 重锚；仅选中项被删才退回最佳匹配。
- **P4**：`refreshAutocomplete` 只在菜单已开时重查**当前 provider 链**，链上透传语义不变。
- **无刷新循环**：`refreshAutocomplete` → `getSuggestions` → `maybeRefresh` 在 TTL 内不再触发。

### 3.6 测试计划（S4）

- `entry-store.test.ts`：`snapshot` 不抛；`refresh` single-flight（并发 3 次 = 1 次 rescan）；超时退回旧快照；`maybeRefresh` TTL 内不触发；`refreshOrSnapshot` 新鲜胜 / 超时退回。
- `autocomplete.test.ts`：rescan 挂起时 `getSuggestions` 仍同步返回 items（不 await）。
- 上游 editor：`refreshAutocomplete` 菜单开/关两态；重查后选中项按 value 保持；项被删退回最佳匹配；text 变了则丢弃。
- 手工：开菜单 → 新建 SKILL.md → 等 TTL → 新项出现且选中项不变；↑↓ 不触发刷新；`pi -p "hi"` 正常退出。

---

## 4. 待裁决

- **D12｜是否推进 S4（突破 P2，改 4 处上游）。**
  推荐：**暂不**。唯一收益是"会话中新增 skill 免 `/reload`"，低频；`/reload` 已覆盖。S4 的 U3 依赖 editor 内部结构（`autocompleteList` / `applyAutocompleteSuggestions`），上游一改即失效——与 A4 拒绝换编辑器的理由同构。
  重审触发：(a) 实际频繁遇到"加 skill 要 reload"；(b) 上游自己加了轻量 refresh。
- **D13｜是否引入会话快照（S0.5，纯插件、~15 行、无刷新）。**
  推荐：**暂不**。H12 成立时快照与现算等价，收益仅省每次按键的少量分配；TR-3 重审条件未到。
- **D14｜TTL 与工具超时取值**（仅 D12 通过时需要）：建议 TTL 30s、工具超时 500ms。

---

## 5. 登记项

- **H12**：会话内 `getCommands()` 不可变（§1.1 证据）→ 待用户确认后补入 `principles.md` §2。
- **TR-3 措辞**：已更新（见 `architecture.md` §6）。
- 新增 **TR-7**（菜单不动不刷新）与 **TR-8**（未校准会话退回原状）。

## 6. 实施记录（2026-11-26）

**裁决**：D12 → 不改上游，走 Path B；D13 → 不引入无刷新的纯快照；D14 → TTL 30s、工具超时 500ms。

**落点**（`my-plugins/skill-ref/`）：

| 文件 | 职责 |
|---|---|
| `src/entry-store.ts` | 快照 + TTL 单飞重扫 + 校准守卫；`entries()` / `refreshed(ms)` / `begin(reason, notify)` |
| `src/rescan-resources.ts` | Path B：一次性 `DefaultResourceLoader({ noExtensions, noThemes, noContextFiles, packageCommandOutput: "capture" })` → `reload()` → 经 `listEntries` 同一投影；`cli` 与 `extension:*` 来源从 pi 的清单保留（`isPinnedSource`）且同名胜出 |
| `src/entry-diff.ts` | `(qualifiedName, path)` 相等判定、名字增减计数、通知文案 |
| `src/refresh-notice.ts` | 通知落点：全屏 → `tui.flash(msg, 1800)`，否则 `ctx.ui.notify(msg, "info")`；TUI 经一次性 widget 工厂捕获（与 clear-to-clipboard 同路） |
| `src/tool.ts` | `execute` 改 `resolveQuery(await store.refreshed(500), params)` |
| `index.ts` | 装配 store；`session_start` 调 `store.begin(event.reason, createRefreshNotice(ctx.ui))` |

**与 §3.3/3.4 的差异**：U1–U4 全部不做（不改上游）；"就地刷新"降级为 TR-7（下一次按键出新列表）；校准守卫替代了对信任态的检测——这是 Path B 原本"从插件侧补不上"的那个洞的闭环。

**通知文案**（用户定稿）：`added === removed > 0` → `Skill list changed`；否则 `Skill list changed: +A/-R skill(s)`；`A = R = 0` 静默。计数含 skill 与 prompt（插件内 "skill" 为通称）。全屏模式走 `tui.flash`（1800ms），其余走 notify toast。

**测试**：`entry-diff.test.ts` / `entry-store.test.ts`（注入式 rescan，覆盖校准、单飞、TTL、失败、超时、跨会话继承）/ `rescan-resources.test.ts`（临时目录端到端，依赖 `packages/coding-agent/dist`）；`integration.test.ts` 改为传入真实 `session_start` 事件并把 cwd / `PI_CODING_AGENT_DIR` 指到空临时目录。全套 155 例通过。

**真实环境冒烟**（`pi --mode rpc` 取 `get_commands`，再用 release dist 跑一次性 loader 比对）：首版只保留 `cli` 来源时校准**失败**——`oh-my-pi-v2` 扩展目录自带的两个 skill 走扩展加载器注册，无扩展的 loader 看不见；把分区推广为 `cli` + `extension:*` 后校准通过（52 = 50 磁盘 + 2 保留，路径零错配，重扫 13ms）。再加/删一个临时 skill 验证通知文案与换入均符合预期。

**真机复现与二次修复**（2026-11-26，tmux + 临时调试日志）：用户 reload 后实测无变化。离线冒烟通过但真机失败，原因是离线比对用的是启动完成后的 `get_commands`，而插件内的校准发生在 session_start 那一刻——`begin()` 同步读 pi 侧得 50 条，重扫回调时 `resources_discover` 已落地、`pinnedCommands()` 看到 52 条 → 校准必败 → 刷新静默禁用。修法：比对改为在重扫结算后再读 pi 侧（两侧同一时刻的快照）。修后 tmux 三段验收全部通过：加 A → `+1/-0`、A→B → `Skill list changed`、删 B → `+0/-1`，菜单在下一次按键换入/换出；`notify(…, "info")` 在 pi 里是聊天区右上角的**持久**状态行，无需加长停留时间。
