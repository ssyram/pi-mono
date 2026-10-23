# FSM 原生子会话 Fleet Widget 设计方案

状态：设计稿，待 owner 审核后实施。来源：owner 要求模仿 `third-party-plugins/pi-subagents/` 的每行右侧信息展示，配合此前提出的 7 行滚轮树形列表与只读查看框。

## 0. 前置结论：pi-subagents 不要与 fsm-compatible 同会话加载

- fsm-compatible 自带原生子会话协调器（`src/children/native-*`）：名单准入、持久 RPC child、深度/血缘、消息/停止/恢复全套。加载 pi-subagents = 第二套独立派发系统：重复的 Agent 工具、重复的 fleet widget、两套互不相识的准入。老问题"派发要非常小心才能成功"正是多系统并存时期的产物。
- child 侧天然隔离：`-ne -e <bundle>` 启动，永远不会带上 pi-subagents 或 omp-v2。风险仅在 root 会话混载。
- 本方案就是在原生协调器上补齐 pi-subagents 的可观测体验，此后 FSM 会话没有理由再装它。

## 1. 目标与非目标

**目标**

1. 编辑器旁持久 widget：树形子会话列表，锁死最多 7 行。
2. 每行右侧三项：上下文用量、运行时长、累计 token（模仿 pi-subagents fleet-status）。
3. 方向键展开/收起嵌套子会话；Enter 打开该子会话的**只读**查看框。
4. 查看 框头部用 `─[Name/ID]───…` 标识当前不是 Main。

**非目标（owner 已放宽）**

- 不替换主 transcript 上下文——Pi 1.3.0 无此 API（可替换区域仅 header/footer/editor；`custom()` 是临时接管）。查看框做到只读即可。
- 不改主界面真实的 `───` 分隔线；`─[Name/ID]──` 只出现在我们自绘的查看框边框上。
- 不做写操作：查看框不能向 child 发消息/停止（那已有 `agent_send`/`agent_stop`）。

## 2. 数据源（已逐项核实）

| 数据 | 来源 | 已核实事实 |
| --- | --- | --- |
| 树结构/血缘 | 协调器 registry（进程内直读，无 IPC） | `binding.parentSessionId` + `registry.find(parent)`，支持任意深度 |
| 行状态 | `NativeChildRecord` | lifecycle（ready/runActive…）、outcome、frozen `model`/`thinking`、`agentName`、cwd |
| token/时长 | child session 文件 `<agentDir>/fsm-compatible/<root>/<child>/session.jsonl` | `message` 条目含 `role:"assistant"`，每条带 `usage{input,output,cacheRead,cacheWrite,totalTokens,cost.total}`、`durationMs`、`timestamp`、`model`、`thinkingLevel`（实测样本验证） |
| 上下文窗口 | 宿主 model registry（同 `host-model-source.ts` 通路） | 按 child frozen `provider/id` 查询 |

派生指标（全部从 session 文件增量计算）：

- **累计 token**：Σ `usage.cost.total`（展示用 `formatFleetTokens` 风格：`12.3K` / `1.2M`）。
- **上下文用量**：最近一条 assistant 的 `input+cacheRead+cacheWrite+output` ÷ 模型窗口 → 百分比。compaction 条目出现后自然回落（读最新条即可，不重建历史）。
- **运行时长**：running = `now − 首条 assistant ts`；结束 = `末条 ts − 首条 ts`。展示 `Ns` / `5m12s` 风格。

**增量读取**：session.jsonl 只追加。每个 child 记一个字节偏移，500ms 轮询只读新增段，避免大文件反复全读。轮询与刷新节流与 pi-subagents 一致（`REFRESH_MS = 500`）。

## 3. Widget 规格

### 3.1 放置与生命周期

- `ctx.ui.setWidget()`，默认 `belowEditor`，配置项 `fleetWidgetPlacement: "aboveEditor"|"belowEditor"|"off"`。
- **belowEditor 是硬推荐而非口味**：viewer overlay 锚在顶部覆盖上方区域时，aboveEditor 的列表会被一同盖住——透不出选中行、没法切 subagent，是最尴尬的死角。放 belowEditor 后布局自上而下为 `viewer（覆盖层）→ transcript（被盖）→ editor → 7 行 fleet 列表 → footer`，列表永远可达，充当 viewer 的常驻切换器。
- 仅 `ctx.hasUI` 时注册（RPC/print/child 会话不注册；child 本来就 `-ne`）。会话关闭时随 runtime 逆序回收。

### 3.2 七行滚轮（不变式）

总渲染行数 ≤ 7，行 = 条目 + 溢出指示。指示行缺席时该行让给一条条目：

```
entries_visible = 7 − (上方指示存在?1:0) − (下方指示存在?1:0)
```

滚动 = 视口在"当前展开态拍平后的条目序列"上滑动（wheel 语义：选中到边缘才移动视口）。

### 3.3 行格式

```
(上方 N 条)
- worker-a  ses_a1b2…  ▸ 2    3%  4m12s  12.3K
- worker-b  ses_c3d4…  ▾        11%    52s   8.1K
  - worker-b.1  ses_e5f6…      0%    12s   1.0K
  - worker-b.2  ses_g7h8… ▸ 1  0%     3s   0.4K
- worker-c  ses_i9j0…  ✓done          —   6m01s  45.2K
(下方 N 条)
```

- 缩进 = 深度；`▸/▾` = 有子节点且收起/展开，`(N, -> to show)` 语义落在该 hint 上；无子节点留空。
- 右侧三列右对齐：`上下文%  时长  tokens`（列宽固定，溢出截断用 `truncateToWidth`）。
- 终态行：`✓done` / `✗failed` / `⟳recovered` 替换上下文列。
- Main（root 自身）固定为第一行条目（`main` 标记，无展开箭头），让总额一眼可见；无 child 时 widget 只显示这一行。
- 身份配色沿用 pi-subagents 的 FNV-hash 选色方案，同一 agent 跨行/跨刷新颜色稳定。

### 3.4 键盘交互（含鼠标边界）

| 键 | 行为 |
| --- | --- |
| `↑/↓` | 移动选中；到视口边缘滚动（每次 1 行） |
| `→` | 展开；对无子节点条目无操作 |
| `←` | 收起；已是顶层则无操作 |
| `Enter` | 打开选中条目的只读查看框 |
| `Esc` | 关闭查看框 / 退出 widget 焦点 |

**鼠标边界**（官方文档明示）：regular 模式鼠标归终端，**点击仅在 fullscreen 模式可用**；regular 模式键盘路径完备即可。方案按键盘为一等公民实现，mouse handler 全屏下免费获得。

## 4. 只读查看框

`ctx.ui.custom({ overlay: true })` 打开，几何对齐 pi-subagents Fleet inspector（`anchor:center, width:95%, maxHeight:85%`）：

```
┌─[worker-b/ses_c3d4e5…]──────────────────────────────┐
│ glm-5.3 · thinking low · 11% ctx · 8.1K tok · 52s   │
│─────────────────────────────────────────────────────│
│ 10:27:59 user      PARITY:root                      │
│ 10:28:01 assistant fsm_enter_fsm …                   │
│ 10:28:03 assistant done                             │
│ …（ScrollView 滚动，500ms 周期刷新）   Esc 返回 │
└─────────────────────────────────────────────────────┘
```

- 头部 `─[Name/ID]──` 嵌在自绘边框里（`Name` = `agentName`，`ID` = `ses_` 前 8 位）——满足“表示这不是 Main”的诉求，且不触碰主界面。
- 内容 = 该 child session.jsonl 的 `message` 条目投影：`HH:MM:SS role 首行文本（截断）`；工具调用显示工具名。
- **实时追加而非快照**：查看框存活期间复用 §2 的增量偏移读取继续 500ms 刷新，并对已渲染行缓存（pi-subagents #2705 验证过同模式：周期刷新保留 transcript 缓存，避免整重绘）。
- 一次交互一个组件实例（官方 `custom()` 契约），完成回调释放。
- **Esc 语义锁死：只退 viewer，永不触碰 child**。关闭 = 调 `done()` 销毁 overlay，child 进程/运行状态零影响。停止 child 只能走 `agent_stop`（协调器另有级联停止）；设计上禁止把 Esc 绑到任何暂停/终止动作，避免“想关窗口结果杀了于代理”。
- **viewer 开启期间行切换 = 实时重定向**：belowEditor 列表仍可通过空编辑器键盘导航切选中行，选中变化时 viewer 立即换目标 child 重新渲染（首屏读该 child 文件 + 订阅其事件流），不需要先 Esc 再重新打开。

### 4.1 输入路由与命令归属（已按 1.4.0 源码核实）

7 行列表**非常驻**：仅 viewer 激活时存在，退出即撤，不影响平时打字。输入管线真实顺序：TUI 内置命令（/model /tree 等）→ 扩展命令分发（/impression 等）→ `input` 事件（我们的重定向点）→ skill/template 展开 → agent run。由此：

| 输入 | viewer 模式下的实际行为 |
| --- | --- |
| 普通文本 | `input` 事件拦截 → `agent_send(child)` 字面发送 ✓ |
| `/skill:name args` | 在展开**之前**被拦截 → 字面发给 child，不做 Main 侧替换；child 模型用自身技能集解析 |
| 未注册的 `/xxx` | 同上，字面发给 child |
| 已注册扩展命令（如 `/impression off`） | **无法拦截**：命令分发先于 `input` 事件，会对 **Main** 执行（agent-session.ts:2101-2108）。不达 child |
| TUI 内置命令（/model /fork /tree…） | 正常 UI 行为，照常执行（onSubmit 直接分发，不经 agent） |
| 自动补全/selector 弹窗 | 编辑器层组件，全部照常弹出；内容反映 **Main** 的注册表 |

Esc 分层规则：仅当 `getEditorText()===""`（空编辑器 ⇒ 无弹窗可关）时我们的 `onTerminalInput` 消费 Esc = 退出 viewer；非空时一律透传给编辑器（关弹窗/清文本）。选 Main 行 = 退出 viewer。

已知 UX 陷阱（接受并文档化，v1 不解）：viewer 中打 `/impression off` 会对 Main 生效而非 child——命令系统属 Main 进程，API 上无法从 input 层截走。

与命令的关系不是争抢而是固定管线的先后：命令分发先于 input 事件，命中即终，我们确定性看不到。与**其他 input 事件扩展**之间才是优先级链：`emitInput` 按扩展注册顺序串行，`transform` 链式传递、`handled` 短路先到先得（runner.ts:1524-1550）。目标环境（`-ne -e` 仅 fsm-compatible）链上只有我们；若同载其他 input 消费扩展则按加载顺序先到先得，无仲裁机制。拦截仅在 viewer 激活窗口内生效，其余时间透传。

不做的功能：渲染 child 的其他插件 widget（loop 等）。child 是 `-ne` 无头 RPC 进程（hasUI=false），那些扩展从未建过 widget，其视觉状态不存在；逐插件逆向渲染无界。transcript 正文渲染（Markdown/工具行）即交付范围。

## 5. 实现落点（每文件 <200 LOC）

```
src/tui/fleet-tree.ts          # registry→树→展开态拍平→7行窗口（纯逻辑）
src/tui/fleet-stats.ts         # session 增量解析 + 三指标派生（纯逻辑）
src/tui/fleet-row-format.ts    # 行文本/右列格式化、配色选择
src/tui/fleet-widget.ts        # 组件渲染 + 键盘 + 轮询接线（setWidget）
src/tui/fleet-viewer.ts        # 只读查看框（custom overlay）
```

- 注册点：`owned-runtime.ts` 组装尾部，`ctx.hasUI` 分支，与 AskUserQuestion 同段；关闭时逆序注销。
- 配置：`runtime-config.ts` 加 `fleetWidgetPlacement`（缺省 `belowEditor`），example 同步。
- 依赖仅 `@earendil-works/pi-tui` 既有原语（Container/Text/ScrollView/matchesKey/truncateToWidth）。

## 6. 测试

纯逻辑模块单测（不拉 TUI）：

- 窗口不变式：任意树/展开态/滚动位置下总行数 ≤7；去掉一个指示行恰好多出一条条目；上下 N 计数正确。
- 增量解析：追加条目后偏移推进；compaction 后上下文回落；损坏行跳过不崩。
- 格式化：token K/M、时长 running/终态、终态替换上下文列。

组件级：沿用 pi-subagents 的测法——对组件喂 fake 数据断言渲染行与按键行为（展开/滚动/Enter 打开查看框回调）。

## 7. “主框换 transcript”可行性调查结论（2026-10-22）

- **官方文档明确无此 API**：`docs/tui.md` 集成点表中可替换区域仅 header/footer/editor；`ctx.ui.custom()` 定义为“临时交互 screen/overlay”。主 transcript pane 不是任何扩展 API 的替换目标。
- **官方 issues 无对应提案**：检索 earendil-works/pi 全部 transcript/session/view 相关 issue，无“主框渲染另一 session”的 API 或功能讨论；最接近的 #9855（Pager mode，open）也只是同一 transcript 的分页浏览，且属 TUI 内部改动而非扩展能力。
- **pi-subagents 同样不换主框**：其 Fleet inspector（`src/tui/fleet.ts:1458`）= `ctx.ui.custom()` overlay（95% 宽/85% 高/居中），内部用 `fleet-transcript.ts` 直接读 child session 文件渲染 bounded 预览；相关 closed issues #1441（trusted-roots 拒读 workflow child）、#1963（live foreground run 的有界 transcript 检视）、#2375（外部 runner 日志）、#2705（周期刷新保留缓存）均围绕此模式演进，从未尝试替换主框。
- 结论：本方案的“overlay + 增量读 child session 文件”即官方 API 下的既定最优模式，与 pi-subagents 架构一致。

## 8. 边界与诚实声明

- regular 模式无鼠标点击；查看框是快照不是实时镜像；无法替换主 transcript/真实分隔线（1.3.0 API 上限，非本方案偷懒）。
- 上下文% 是"最近一次模型调用"的窗口占用，不含 pending 未发送内容；compaction 后读数回落属正常。
- child 崩溃后行状态由 registry lifecycle 驱动，token/时长停在末条记录。

## 9. 细化设计（函数级）

### 9.1 goal → 模块映射

- G1 七行滚轮树 → `fleet-tree.ts`（主）+ `fleet-widget.ts`（渲染）
- G2 右列三指标 → `fleet-stats.ts`（主）+ `fleet-row-format.ts`（格式化）
- G3 贴沿 viewer 实时渲染 → `fleet-viewer.ts`（主）+ `fleet-measure.ts`（贴沿）+ `fleet-stats.ts`（增量）
- G4 输入重定向/Esc 分层 → `fleet-input.ts`
- G5 注册/接线 → `owned-runtime.ts` hasUI 段 + `native-runtime.ts` 暴露 `fleet()` 视图

关键假设：
- H1 主屏根渲染以终端高度为界（transcript 被夹紧）；不成立则 viewer 回退保守 60%（实现期真终端验证）。
- H2 child 事件流（`message_update`/`text_delta`）经 coordinator `onEvent` 已在 root 进程内可达。
- H3 运行时 Pi ≥1.3.0（§API 核对表已实测）；插件类型 pin 同步 1.3.0。

### 9.2 数据结构

- `FleetNode = { key: string; name: string; shortId: string; depth: number; children: FleetNode[]; record?: NativeChildRecord }`（root 无 record）。不变量：key=sessionId 全树唯一；depth=parent.depth+1。
- `FleetFlatRow = { node: FleetNode; hasChildren: boolean; expanded: boolean }`——展开态拍平序列。
- `WindowState = { flat: FleetFlatRow[]; selected: string; top: number }`。不变式（7 行）：`rows(flat,top) 满足 total ≤ 7 ∧ entries = 7 − topInd − bottomInd ∧ topInd=1 ⟺ top>0 ∧ bottomInd=1 ⟺ top+entries<len`；无指示行时该行让位给条目。
- `ChildStats = { totalTokens: number; ctxPercent: number|null; firstTs: number|null; lastTs: number|null }`；派生：elapsed = live? now−firstTs : lastTs−firstTs。
- `StatsReader = { offset: number; stats: ChildStats }` per child sessionFile；增量只读新增字节，损坏行跳过不计入。

### 9.3 模块规约

**fleet-tree.ts**
- `buildFleetTree(registry): FleetNode` — post：叶=registry.rows 全集，父子边=parentSessionId；无孤儿（root 兜底）。
- `flattenVisible(tree, expanded: Set<string>): FleetFlatRow[]` — 展开态∩有子节点；收起子树整枝剪除。终止性：节点有限，访问标记防环。
- `windowRows(flat, top): { lines: FleetLine[] }` — 7 行不变式入口（见 §9.2）；`FleetLine = {kind:"overflow-above"|"overflow-below"|"entry", row?, hiddenCount?}`。滚动语义：selected 逼边才 top±1。

**fleet-stats.ts**
- `advance(reader, filePath, contextWindow): Promise<ChildStats>` — pre：文件存在或从未存在；post：offset 前移至末次完整行尾；Σcost.total 单调不减；ctxPercent 取最近 assistant 的 input+cacheRead+cacheWrite+output ÷ window；无 assistant → null。compaction 条目不回滚累计。
- `elapsedText(stats, now, terminal)` — running/终态两式。

**fleet-row-format.ts**
- `formatTokens(n)`: <1000 原值；K/M 一位小数。`formatElapsed(ms)`: `Ns/Nm Ns`。
- `renderRow(row, selected, width, theme)`: 左=缩进+name+短ID+展开hint，右=三列右对齐；`truncateToWidth` 保宽；终态行 ctx 列替换 ✓/✗/⟳。身份色：name 的 FNV-1a hash → 主题 accent 序列，跨刷新稳定。

**fleet-measure.ts**
- `editorTopRow(tui): number|null` — 走 `tui.children` 找含编辑器（getText/setText/handleInput 结构判据）的子树 i；`rows − Σ_{k≥i} render(width).length`；编辑器未挂载/异常 → null。只读；只渲染编辑器块及之后的兄弟，transcript 跳过。

**fleet-widget.ts**
- `FleetWidget` 组件：`render(width)` 缓存按 (windowKey,width)；500ms tick 重算 stats+invalidate+requestRender。
- 激活态机：inactive →(空编辑器+↓/←/j)→ active →(↑↓ 移动/→ 展开/← 收起/Enter 开 viewer)→ active →(Esc[空编辑器] 或选 Main)→ inactive。无 child 时仅 Main 单行且不可激活导航。

**fleet-input.ts**
- `input` 事件 handler：viewer 激活且文本非命令前缀拦截路径（命令已在更早层分发，handler 只会见未命中命令的文本）→ `agent_send(viewerTarget, text)` → `{action:"handled"}`；否则 continue。
- `onTerminalInput` 路由：编辑器有焦点且空文本才可激活导航；非空一律透传。与 viewer 的 Esc 分层同判据。

**fleet-viewer.ts**
- `openViewer(ctx, target, deps): Promise<void>` — `custom({overlay:true, anchor:"top-center", width:"100%"})`；组件行数=editorTopRow()（null→60% 保守）；首屏有界 tail（500 条）+ `(前面 N 条)`；存活期 500ms 增量 + coordinator 事件订阅即时追加；done() 即释放订阅。头部 `─[name/短ID]──` + 模型/thinking/三指标行；正文 user/assistant（Markdown 组件）/工具名行。

**接线**
- `NativeRuntime` 增 `fleet(): { list(): readonly FleetChildView[]; subscribe(l: (e: ChildEvent)=>void): ()=>void }`；coordinator 构造 listeners 集合，`event()` 分发。
- `owned-runtime.ts` hasUI 分支：`offs.push(registerFleetUI(pi, ctx, config, () => native.fleet()))`；config 增 `fleetWidgetPlacement?: "aboveEditor"|"belowEditor"`（默认 belowEditor，"off" 不注册）。
- `runtime-config.ts`/example 同步；类型 pin @earendil-works/* → 1.3.0，新增 pi-tui devDep。

### 9.4 错误处理

sessionFile 读取失败：该 child 行右列显示 `—`，不中断其他行；stats reader 崩溃自恢复（offset 保留）。viewer 打开时 child 消失（被 stop）：头部标 ✗、停止增量。measure 异常一律 null 回退。tick 内异常吞掉并保留上次渲染（下 tick 重试）。

### 9.5 测试点

纯逻辑（node:test，无 TUI）：窗口不变式性质测试（任意树/展开态/滚动：总行 ≤7、指示行让位恰好多一条、上下 N 计数、选中逼边滚动）；增量解析（追加/损坏行/compaction 回落/Σ单调）；格式化（K/M、时长两式、终态替换、宽度截断含宽字符）；flatten（展开/收起/防环）。
组件级：fake tui/theme 断言渲染行与按键态机（激活/移动/展开/Enter/Esc 空编辑器分层）。
集成：tmux 实测（见 §10）。
