# 修正方案：原子 visual block 与 native commit boundary

状态：实现已落地；Round 006修复了nonzero physical origin、retained viewport、bottom slack、重复native render和`agent_settled`边界。旧 `ProtectedHistoryRows` / 手工 history insertion 模型已删除；不得重新引入 padding 或 line-spill 补丁。Production-wide证明仍受terminal/IME矩阵限制。

## 1. 现象与可复现证据

### 1.1 顶部 slack

`/tsnapshot` `2026-08-04T10-13-54.959Z` 记录：managed area 为物理行 `2..34`；frame 的 `0..9` 是十行合成空行，Editor 是 frame `28..30`，Footer 是 `31..32`。Terminal.app 的 35 行与 `stableRows + frame.rows` 逐行相同。这证明空白由插件写入，不是 Terminal.app 误判。

### 1.2 component 被拆开

同一 artifact 同时在 `stableRows` 和 managed frame 中包含绿色 tool/task bytes。`ProtectedHistoryRows.previewAppend()` 把裸 `string[]` 以 `slice(0, spillCount)` 分成 spill/protected 两段；它不保存 visual component 的边界。因此一个三行 block 可以出现“第一行在 stable/history、其余行在 live”的状态，并被顶部 slack 隔开。

### 1.3 长 block 的单次闪动

`history-insertion.ts` 在 top scroll region 内对每个 spill row 发 `CRLF + row`，随后 `screen-frame-diff.ts` 对 changed frame rows 发 `EL2 + row`。虽然这包在 synchronized output 中且不含 `2J`/`3J`，但长 block 会使一次 terminal transaction 同时包含多行滚动和多行 frame 重写；它是插件制造的可见 layout jump。

## 2. 根因：D 层模型错误

旧设计把三种不同的事实压成“row FIFO”：

```text
Ledger item（finality/source order）
→ render item 为 string[]
→ ProtectedHistoryRows（只保存行）
→ spill rows / StableScreenRows（只保存行）
```

这违反现有原则中“历史每项只有一份、运行时不反复重画既有历史”和“静态恢复必须原生等价”的组合要求。问题不是某个 `slice` 的局部 bug：一旦 physical history 由插件按行模拟，component 原子性、native 静态语义和低扰动 terminal 更新不能同时被该模型表达。

以下旧 D 选择被明确拒绝：

- `ProtectedHistoryRows` 作为裸行队列；
- 在运行期由插件用 scroll region 插入 history；
- 以顶部 slack 把 Editor/Footer 固定到 terminal bottom；
- 把“已 finalized”直接转译为“可逐行 spill”。

## 3. 候选方案与选择

| 方案 | component 原子性 | 静态原生等价 | 插件自造 history 闪动 | 结论 |
|---|---|---|---|---|
| 修补 row FIFO | 否 | 否 | 仍有 | 拒绝 |
| block-aware 手工 scroll region | 是 | 部分 | 仍有长 block scroll transaction | 拒绝 |
| 运行期插件完整重写 TUI/scrollback | 可达 | 否，维护范围过大 | 需重新证明 | 拒绝 |
| managed suffix + Pi native commit boundary | 是 | 是 | 无插件手工 history transaction | 采用 |

## 4. 采用架构

### 4.1 两个 owner 的职责

```text
active managed:
  插件只画 first-unfinished 及其后的 mutable suffix。
  它不拥有 completed history，不维护 ProtectedHistoryRows，
  不发 scroll-region CRLF insertion。

native commit boundary:
  当 source-order 最大连续 finalized prefix 出现时，
  以 Pi 的 component tree 为唯一真相观察一次native frame；
  若与已可见physical frame等价，则原子prime Pi baseline而不二次render，
  再从第一个 unfinished component 建立新的 managed suffix。
```

native commit 是 renderer ownership transition，不是 AI/session transition：message、tool、provider、Editor、input 和 session 不变。它复用 Pi 对 component tree、scrollback、Editor、footer 的原生语义，满足 idle 与 dynamic→static 都回到同一静态行为的意图。

### 4.2 VisualBlock

新的最小显示单位是 `VisualBlock`，而不是 row：

```ts
interface VisualBlock {
  itemId: string;
  rows: readonly string[];
  finality: "pending" | "finalized";
}
```

`rows` 只能整体处于以下之一：

```text
native committed | managed live | terminal-cropped pending view
```

禁止一个 block 的任意 row 同时处于 native committed 与 managed live。超高 pending block 可以在 managed view 被裁掉，但它在 finalize 时必须整体交给 native commit，不能被 partial spill。

### 4.3 Bottom slack

managed frame 的唯一合法语法改为：

```text
pending visual blocks
→ status/widgetAbove
→ Editor
→ widgetBelow
→ Footer
→ slack
```

`slack` 是 frame 的尾部。它只表示 terminal 底部未被内容占据的真实空行；禁止出现在任何 transcript block 前。组件或 widget 缩短时，只能清除它曾拥有的末尾行，Editor/Footer 允许上移，不能为维持底部锚定而清除或位移上方稳定行。

### 4.4 Commit transaction

```text
1. detect maximal source-order finalized block prefix
2. stop managed terminal writes; preserve current logical tree unchanged
3. verify/prime Pi baseline from the actual visible frame
4. 原子prime Pi baseline；不调用saved native `doRender`，避免第二次component observation
5. if run still has unfinished content: gate again, DSR recapture,
   seed a new managed frame at the first unfinished block
6. otherwise remain idle-native
```

不得调用 `requestRender(true)` 作为 ordinary commit；width reflow 仍是唯一允许的 mandatory `2J/3J` 路径。若 baseline proof、native transition 或 recapture 任一步失败，留在 native，不伪造 managed provenance。

## 5. 正确性论证

### P1：无顶部 padding

按 §4.3 的 frame grammar，`slack` 仅能追加在 Footer 后。render 顺序不含“slack 在 live 前”的分支，故任何 slack 都位于当前内容以下。widget/status 收缩只增加末尾 slack；不会在 transcript 与其余内容之间产生空洞。

### P2：无 component split

只有 `VisualBlock` 能跨 owner 转移；transaction 输入是 finalized block prefix，不是 `string[]` spill prefix。一次 commit 要么移交完整 `rows`，要么不移交。由归纳法，初始无 split；每次 transition 保持每个 block 仅在一个 owner；因此任何 component 不可能一部分在 native history、一部分在 managed live。

### P3：无插件制造的 history-insertion flash

active managed 不发 scroll-region 设置、history `CRLF` 或 block-to-history 的 `EL2` 重排。Commit只采纳已经由同一managed transaction写成的physical frame，不产生第二次terminal write，也不再次render component。因此旧“top region scroll + frame diff”和native commit闪动路径均被删除。

后续真正native update仍按Pi自身diff/full-redraw条件执行；width reflow仍是普通支持路径中唯一允许的mandatory `2J/3J`。

### P4：AI 与输入隔离

commit transaction只切换 instance renderer method 和 terminal provenance。它不调用 `sendMessage`、不修改 session entries、provider/tool state、Editor state、input bytes 或 keybindings。native renderer再次成为唯一 terminal writer后，Pi 原生处理 Editor/IME/footer。

## 6. 实施门禁与回归

`ProtectedHistoryRows`与`history-insertion.ts`已删除；`StableScreenRows`只保留可见bytes handoff attestation，不参与history ownership。禁止以兼容shim重建active row spill。

| 类型 | 回归/验收 |
|---|---|
| 回归 | 三行绿色 block finalize，断言没有 row 同时出现于 native prefix 与 managed suffix |
| 回归 | task/status 10 行→0/1 行，断言所有 synthetic blank rows仅在 Footer 后 |
| 回归 | 长 finalized block commit，断言插件 ANSI 不含 scroll-region、history CRLF 或由 commit 导致的 frame-wide EL2 |
| 回归 | commit 后 unfinished tool 仍运行，断言 native commit → DSR recapture → managed suffix ownership顺序唯一 |
| 回归 | native commit/recapture失败，断言停留 native、无重复 history、无 patch ownership残留 |
| artifact | `/tsnapshot` 验证 Terminal.app visible rows与当前 owner frame逐行相同；记录任何 Pi-native `2J/3J`，不能归因于插件 |
| static | `agent_settled`、abort、stop、reload、width各自最终由 Pi native renderer显示；低层`agent_end` continuation不交权 |

## 7. 代码更新清单

| 范围 | 计划改动 | 状态 |
|---|---|---|
| `protected-history-rows.ts` / `history-insertion.ts` | 删除 active row-history ownership | 已实施 |
| `stable-screen-rows.ts` | 限定为 native handoff attestation | 已实施 |
| `volatile-region.ts` | bottom slack grammar | 已实施 |
| `transcript-ledger.ts` / renderer | finalized prefix native commit，禁止 line spill | 已实施 |
| `runtime-patch.ts` / coordinator | native commit → DSR re-entry lifecycle | 已实施 |
| tests | block atomicity、bottom slack、no manual insertion、commit/re-entry | 已实施 |

## 8. 文档更新清单

| 文档 | 计划改动 | 状态 |
|---|---|---|
| `architecture.md` / `detailed-design.md` | 标记旧 row-history 设计拒绝并链接本方案 | 本次已更新 |
| `detail/volatile-region.md` / `detail/stable-history-tail.md` / `detail/history-insertion.md` | 记录禁止性规则与 supersession | 本次已更新 |
| `known-state.md` | 记录当前实现不满足的 D 层缺陷 | 本次已更新 |
| README、architecture、detailed-design、known-state | 已按新契约更新 | 本次已更新 |
