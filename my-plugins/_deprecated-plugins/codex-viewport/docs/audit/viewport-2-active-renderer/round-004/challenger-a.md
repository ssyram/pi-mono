# Round 004-A Challenger — Sound + Optimization

## 审查范围

- 对象：`my-plugins/codex-viewport/` 当前代码、测试、README 与设计/证明文档。
- 消费者：Pi 0.83 的 `packages/tui/src/tui.ts`、`packages/tui/src/terminal.ts`、`packages/coding-agent/src/core/agent-session.ts`、extension runner、interactive-mode component/lifecycle 路径。
- 上游：
  - `docs/design/principles.md`
  - `docs/design/architecture.md`
  - `docs/design/detailed-design.md`
  - `docs/design/detail/`
  - `docs/design/proofs/`
  - `docs/design/known-state.md`
  - `docs/audit/viewport-2-active-renderer/workflow-compliance.md`
- 本轮重点：Sound、Optimization。
- 本轮不做完整结论：全量 Complete/Concise、所有 component constructor 覆盖、所有文档镜像与 obsolete artifact 穷尽留给 Round 004-B。

---

## Findings

### A-S1 — MAJOR — DSR 输入过滤不能保持输入链透明

**证据**

- `query-terminal-cursor.ts:8` 将裸 `ESC`、`ESC[`、带数字/分号的 CSI 前缀全部视为潜在 DSR。
- `query-terminal-cursor.ts:35-40` 在 query timeout/write failure 后继续保留过滤器 1000ms。
- `query-terminal-cursor.ts:58-63` 对这些前缀返回 `{ consume: true }`，不立即交给 Editor。
- `query-terminal-cursor.test.ts:51-71` 只证明显式 Abort 会 replay 裸 `ESC`，未覆盖自然 timeout。
- Pi 把 Escape 定义为真实按键：`packages/tui/src/keys.ts:301-303`。
- Pi 的 terminal input listeners 按注册顺序执行：`packages/tui/src/tui.ts:771-780`。插件不能保证自己的 DSR listener 排在其它 extension listener 之前。

**违反的上游**

- `principles.md:10`：流式输出期间用户输入必须稳定。
- `principles.md:20-21`：不能改变 AI/工具/输入行为来修显示。
- `principles.md:26`：复杂输入 composition/commit 不得因 terminal ownership 错位。
- `architecture.md:42`：“只消费 DSR，并把邻接输入返回 input chain。”
- `principles.md:28`：ownership 切换必须与 terminal 真实状态一致；把输入序列误判成 cursor report 可使 origin 推导基于假位置。

**具体反例 1：裸 Escape 被延迟**

1. `agent_start` 或 width re-entry 发送 `CSI 6n`。
2. 用户在 150ms query 窗口按 Escape。
3. `DSR_PREFIX` 匹配整个 `"\x1b"`。
4. listener 返回 `{ consume: true }`。
5. terminal 不返回 DSR，query 在 150ms timeout。
6. `retainLateFilter()` 再保留 listener 1000ms。
7. Escape 最迟约 1150ms 后才经 `replayInput` 到达 Pi；这已改变 abort/cancel 输入时序。

**具体反例 2：其它 extension 先看到 DSR**

1. 另一个 extension 更早注册 `onTerminalInput`。
2. Pi 按 Set 插入顺序先调用它。
3. terminal DSR response 在到达 codex-viewport listener 前，已经被前置 listener 观察。
4. 当前插件只能阻止后续 listeners/Editor，不能兑现“DSR 对原输入链不可见”。

**具体反例 3：合法键序列与 DSR 字节碰撞**

完整 `CSI <n>;<m>R` 被无条件解释为 cursor report。该字节空间也可由终端键协议产生；当前实现没有 request correlation、geometry validation 或 input-vs-response 判别层。若碰撞值形成合法 origin，插件可基于键输入建立错误 physical baseline，而非仅 fail-open。

**根因层**

- **D**：设计假设 extension-level `onTerminalInput` 可以透明地区分 DSR response 与用户输入，但该 API 位于有序 listener 链内部，且 DSR 无 correlation ID。
- **I**：自然 timeout 对 buffered input 使用 1000ms late-filter 生命周期。

**同根因范围**

- 首次 managed entry。
- 每次 width re-entry。
- DSR write failure。
- DSR timeout/late response。
- 与任何使用 `onTerminalInput` 的 extension 共存。
- Escape、DSR-prefix CSI、终端复杂键编码。

**处置分类**

- **触发用户决策门**。
- 局部可修部分：给 buffered user prefix 单独设置短 fragment timeout，不能等同于 1000ms late-response window。
- 架构未决部分：extension API 无法保证 DSR 对更早 listener 隐身，也无法一般性区分同字节键序列。需要在以下路径中正式选择：
  1. 接受并登记输入碰撞/短时延风险；
  2. 上游 Pi 提供 query-response 专用的 raw-input 前置通道；
  3. 放弃每-run DSR，改用可证明的 native physical-origin API；
  4. 仅在无输入活动的安全点查询并对任何并发输入取消 entry。

---

### A-S2 — MAJOR — Terminal height shrink 后继续使用旧 absolute-row provenance

**证据**

- `managed-renderer.ts:78-86` 仅把 width change 升格为新 epoch；height change直接进入 `rebaseManagedHeight()`。
- `managed-height-rebase.ts:6-8` 只做：
  - `nextBottom = min(oldBottom, newHeight)`
  - `nextTop = min(oldTop, nextBottom - mandatoryRows)`
- `screen-frame-diff.ts:7-15` 在 height change 后仍以旧 `previous.area.top` 和绝对 row 比较。
- Height change 时没有 DSR、native redraw或 terminal-buffer re-attestation。
- Pi 自身明确认定非-Termux height resize需要 full redraw 以保持 viewport 对齐：
  - `packages/tui/src/tui.ts:1261-1264` 重算 `prevViewportTop`。
  - `packages/tui/src/tui.ts:1351-1357` 注释和实现均执行 `fullRender(true)`。
- 当前 regression 只改 fake terminal 的整数：
  - `resize-epoch.test.ts:28-39` 直接赋值 `.rows`。
  - Fake 没有模拟 xterm/terminal resize 对 viewport、cursor、scrollback 的物理移动。

**违反的上游**

- `principles.md:9-14`：动态内容不能遗留旧版本、历史必须单份。
- `principles.md:27`：Editor/status/footer不能被推离物理屏幕。
- `principles.md:28`：owner 切换和 physical state必须一致。
- `architecture.md:37`：managed owner的 physical provenance 必须成立。
- `architecture.md:55-61`：area增长/位移只由真实 content pressure导致。
- `known-state.md:17`：无新内容占用时稳定行不得位移。
- `architecture.md:102`、`known-state.md:25`：height 留在 managed mode；这是当前未被证明的设计承诺。

**具体反例**

前态：

```text
terminalHeight = 24
area = [10,24)
rows 10..21 = mutable tool/progress
rows 22..23 = Editor/footer
```

终端缩到 12 行。常见 inline terminal 行为是保持 cursor/latest tail 可见，使旧底部 12 行成为新 viewport：

```text
new physical rows 0..9  = old mutable rows 12..21
new physical rows 10..11 = old Editor/footer
```

当前 plugin 计算：

```text
nextBottom = 12
nextTop = 10
nextArea = [10,12)
```

随后只管理新 rows 10..11。已经被 terminal resize 移到新 rows 0..9 的 mutable progress 被错误划出 managed ownership；它可以：

- 留下旧 elapsed/progress 版本；
- 与后续新 tail重复；
- 不再接受 overwrite；
- 被错误当成 stable screen 内容。

`StableScreenRows.known=false` 只会阻止 seamless handoff，不能修复运行期 stale cells。

**根因层**

- **D**：把“terminal.rows 数值变化”当作单纯可用容量变化，没有规定 terminal emulator 对 inline viewport/scrollback/cursor 的 resize 后置条件。
- **I**：height rebase只裁 geometry，不重建 absolute physical mapping。
- **Test**：fake terminal不实现 resize 物理语义，却被用于证明 height managed-safe。

**同根因范围**

- Terminal height shrink。
- 软件键盘/IME导致的 rows 改变。
- tmux pane纵向resize。
- resize时 cursor 位于 managed bottom。
- area尚未占满、area已占满两种情况。
- terminal grow-after-shrink 的旧 provenance 继承。

**处置分类**

- **触发用户决策门**，因为修复会改变已确认的 resize tradeoff。
- 候选：
  1. Height 与 width 同样走一次 native redraw + DSR re-entry：最简单、最容易证明，但允许一次闪烁。
  2. Height 专用 gate + DSR + terminal-specific viewport mapping：保留无 full redraw目标，但增加 terminal compatibility contract和测试矩阵。
  3. 仅 Termux采用 managed height policy，其它终端遵循 Pi native redraw语义。

---

### A-S3 — MAJOR — Width recapture gate 中的 dirty state 可在 `TUI.stop()` 被丢弃

**证据**

- Width native redraw成功后：
  - `runtime-patch.ts:161-175` 设置 `renderer=undefined`、`nativeFrameCurrent=true` 并进入 recapture。
- Recapture gate收到 render：
  - `runtime-patch.ts:155-157` 仅设置 `gateRenderPending=true`。
- 正确 catch-up 方法已存在：
  - `runtime-patch.ts:109-114` `returnToNativeFromWidthGate()` restore methods后在 dirty 时调用 original native render。
- 但 patched stop未使用它：
  - `runtime-patch.ts:122-128`
  - `nativeFrameCurrent` 分支直接 `dispose(false)`，丢弃 `gateRenderPending`。
- Ctrl+Z consumer实际调用 `this.ui.stop()`：
  - `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3647-3652`
- `SIGCONT` 后才 `requestRender(true)`：
  - `interactive-mode.ts:3639-3645`
  - 因此 stop 前 physical/native baseline 可以处于过时状态。

**违反的上游**

- `principles.md:22-25`：所有运行→静止、stop/reload恢复路径必须得到相同原生静态结果。
- `principles.md:28`：ownership切换时接手方必须与 terminal真实状态一致。
- `principles.md:35-38`：禁止 baseline 未对齐交权、agent停止后残留临时状态。
- `architecture.md:120`：width recapture gate“屏幕已经是native”只在 gate 期间无后续变更时成立。
- `detail/lifecycle-failure.md` 的 stop/recovery契约未覆盖 dirty width gate。

**具体反例**

1. Width change触发一次 native redraw。
2. DSR recapture等待中。
3. Assistant/tool/status更新；Pi requestRender已被 patched `doRender`消费，`gateRenderPending=true`。
4. 用户 Ctrl+Z。
5. patched `stop()`因 `nativeFrameCurrent=true`执行 `dispose(false)`。
6. Dirty update未交给 native renderer。
7. `originalStop()`依据 width redraw时的旧 native baseline移动cursor并退出raw mode。
8. 直到未来 SIGCONT force redraw前，stop边界不是用户要求的原生静态结果。

**根因层**

- **I**：width-gate cleanup已在 coordinator的 finish/shutdown/session-replace路径修复，但 TUI.stop consumer遗漏同一 helper。

**同根因范围**

- Ctrl+Z。
- External editor或任何直接调用 `TUI.stop()` 的 consumer。
- Width recapture期间存在任何已被 gate消费的 component/editor/footer update。
- `originalDoRender` catch-up本身抛错的 stop路径。

**处置分类**

- **非决策项，直接修**。
- `stop()` 的 `nativeFrameCurrent` 分支应调用 `returnToNativeFromWidthGate()`，而不是 `dispose(false)`；catch-up失败必须保持 `originalStop()` 的 finally语义并有 regression。

---

### A-O1 — MINOR — Fixed-area时代的无消费者状态扩大了 ABI 与证明面

**证据**

- `tui-internals.ts:29` 的 `clearOnShrink` 在插件生产代码无读取者。
- `tui-internals.ts:31` 和 `tui-internals.ts:47` 强制要求 `logDirectory:string`，但插件无任何消费；这会让 otherwise-compatible TUI 无理由 fail-open。
- `inline-viewport-area.ts:22-31` `sameViewportArea()` 无调用者。
- `viewport-expansion.ts:21-26` `expandedViewport()` 仅由测试调用，生产 growth已由 `live-region-growth.ts`替代。
- `transcript-ledger.ts:70-75` `markRendered()` 仅测试调用。
- `component-ledger-reconciler.ts:109-113` `renderItemComponents()` 无调用者。
- `native-entry-baseline.ts:13,17-18,91,95-96`：
  - `expansion`
  - `displacedEntryRows`
  - `originalOriginRow`
  均写入但不被 `ManagedRenderer`消费；constructor只读取 area/frame/stable/baseline fields（`managed-renderer.ts:51-67`）。

**违反的上游**

- SCCO Optimization：已知更简单且依赖面更小的候选必须采用。
- `principles.md:16,29`：只接管必要边界，尽量降低维护成本。
- `detailed-design.md` 当前模块/类型描述已不需要上述fixed-area遗留面。

**根因层**

- **I**：fixed-area→variable-area迁移未完成dead-state收敛。
- **D mirror**：若遗留字段仍在proof/doc术语中，应同步删除或改成真实消费者契约。

**同根因范围**

- Structural ABI probe。
- Entry baseline type。
- Pure geometry helpers。
- Ledger/reconciler API。
- Tests that exist only to preserve dead production helpers。

**处置分类**

- **非决策项，直接修**。
- 删除未使用字段/helper及其专用测试；`tuiInternals()`只探测运行时真正消费的字段。

---

## Severe Complete/Concise issue recorded for Round B

### A-X1 — Height verification claim exceeds test model

`known-state.md:39-40` 将“height rebase”列为自动覆盖；实际 `resize-epoch.test.ts:28-39` 仅变更整数，不模拟 terminal viewport/scrollback/cursor resize。该证据只能证明 arithmetic branch执行，不能证明 physical correctness。Round B 应把所有“verified”声明拆成：

- pure geometry verified；
- xterm/VT physical resize verified；
- real terminal verified；
- unverified。

---

## Optimization alternatives attacked

### O-ALT-1 — Height native redraw + managed re-entry

**结论：在当前 SCC 下支配现实现，但会触发已登记设计权衡。**

- Sound：复用 Pi 已有 height full redraw语义，重新建立 physical provenance。
- Complete：可覆盖所有非-Termux height resize。
- Concise：复用现有 width epoch machinery，少于 terminal-specific height mapping。
- Cost：一次可见 flash/scrollback rebuild。
- 因为 `principles.md:10` 明确输入正确和历史单份优先于绝对零重绘，该成本不直接违反Q；但会修改architecture/known-state中的height无native承诺，须用户裁决。

### O-ALT-2 — Height专用 DSR re-attestation，不做 native redraw

**结论：当前证据不足，未证明支配。**

它仍需明确各terminal resize后 old→new physical row mapping；DSR只给cursor，不给整屏cell provenance。没有terminal-specific contract或screen capture时，不能由一个cursor位置证明所有stable/live rows归属。

### O-ALT-3 — 删除DSR，仅使用Pi logical baseline

**结论：不支配。**

Pi是inline TUI，logical `previousViewportTop/hardwareCursorRow`不能单独给出screen physical origin。删除DSR会失去absolute CUP/history insertion的sound anchor。

### O-ALT-4 — 上游Pi提供raw query-response通道或physical-origin API

**结论：长期支配当前 extension-level DSR filter；当前仓库API尚不存在。**

它能在 input-listener链之前消费terminal response，消除前置listener泄漏，并可避免DSR/keyboard ambiguity。需要官方Pi API变化，不是当前插件内局部优化。

### O-ALT-5 — 完全复用Pi native renderer，不接管history insertion

**结论：不支配。**

它恢复简单性，但无法满足运行中只更新live tail、completed prefix单份进入history的核心目标。

### O-ALT-6 — Alternate-screen/full TUI takeover

**结论：不支配。**

它可简化physical provenance，却违反“只接管必要动态边界”和“不重实现整套TUI”。

### O-ALT-7 — 停止每帧验证 committed component snapshots

**结论：未证明支配。**

Pi允许 custom renderers、theme/outputPad/expanded invalidation；移除检测会让已physical-committed component后续变化静默产生历史不一致。若要优化，应先建立可靠immutable component contract，而不是直接删除检查。

### O-ALT-8 — 删除 A-O1 dead state/helper

**结论：严格支配现状。**

不改变行为、减少 private ABI fail-open条件、缩小模块和证明面，无新风险。

---

## Coverage status

### S — Sound：**partial / failed**

已检查：

- Q→D→I structural locality；
- DSR/input chain；
- variable area/history/cursor transaction；
- width/height resize；
- width recapture failure/stop consumers；
- extension event ordering；
- AI/session payload isolation；
- terminal write/recovery ownership；
- Pi component mutation与source-order ledger。

未通过项：

- A-S1 DSR input transparency；
- A-S2 height physical provenance；
- A-S3 dirty width-gate stop。

### O — Optimization：**partial / failed**

已检查：

- native-only、full takeover、DSR-less、height native epoch、height DSR epoch；
- committed snapshot validation；
- private ABI与dead helper surface。

未通过项：

- A-O1 removable dead surface；
- A-S2当前height方案被更简单sound fallback候选支配，待用户裁决。

---

## Reserved for Round 004-B

- 所有 constructor/component kind 的完整 finality contract表。
- CustomEntry、status/error/cache notices、spacers、compaction/retry transitions。
- Ctrl+O、theme/outputPad、custom footer/header、extension custom UI的全量消费者矩阵。
- Docs/README/proofs跨文件陈旧语义与重复规则机械扫描。
- 所有 source/test 的dead export和module合并机会。
- Hard death/session reload/branch/fork完整覆盖。
- Direct stdout、terminal allowlist、Zellij/Termux policy完整性。
- 测试声明与真实 evidence逐条映射。
- Full Concise judgment。