# codex-viewport 详细设计

## 1. 文件职责

- `codex-viewport.ts`：注册 lifecycle observer。
- `assistant-containment.ts`：判定 assistant 动态块是否需要进入 LiveRegion。
- `runtime-coordinator.ts`：管理 run phase、tracker 和 restore barrier。
- `runtime-patch.ts`：安装仅含 render 前置 reconcile 的 wrapper。
- `completion-tracker.ts`：维护 source-order completion frontier。
- `viewport-bridge.ts`：移动、释放和恢复 components。
- `live-region.ts`：组合 tracked components 并计算可见尾部。
- `visible-live-lines.ts`：纯 suffix 裁剪。
- `component-shapes.ts`、`tui-probe.ts`：当前 Pi component/layout 识别。
- `tui-internals.ts`：只暴露私有 `doRender` 签名。

插件没有 active terminal renderer、ANSI buffer builder 或 baseline adapter。

## 2. CompletionTracker

`beginAssistant()` 追加默认不 contained 的 assistant unit。thinking 或未知 assistant block 通过 `containCurrentAssistant()` 启用 containment；普通 text 与 tool-call metadata 保持原生。`ensureTool(id)` 去重追加始终 contained 的 tool unit。completion 方法只改变完成标志。

`releaseCompletedPrefix()` 从队首依次释放 `completed && component` 的最大连续前缀。后面的 tool 即使先完成，也必须留在 tracker 中等待前序 unit。

`reset()` 删除当前 run 的全部 transient references，不持久化任何内容。

## 3. ComponentBridge

`reconcile()`：

1. 扫描 chat children，识别新的 assistant/tool component。
2. 只将 `contained=true` 的 tracked component 从 chat 移到 `LiveRegion`；普通文字 assistant 保持原位置。
3. 同步原 component 的 expanded 状态。
4. 把 completion frontier 返回的完整 components 插在 LiveRegion anchor 前。
5. tracker 为空时移除 LiveRegion。

`restore()`：

1. 按 tracker source order 插回当前 detached components。
2. 已在 chat 中的 component 不重复插入。
3. 移除 LiveRegion。

bridge 只改变 component 位置，不修改 component 的 message、tool result 或 renderer 数据。

## 4. Native render patch

### 4.1 安装

`installRuntimePatch()` 拒绝以下状态：

- TUI 不可扩展。
- 已有本插件 marker。
- `doRender` 已是 instance-own method。
- chat layout 无法通过 `children`、`removeChild`、`render`、`invalidate` 结构契约识别。

组件 class 可能分别来自 workspace 和 global Pi 的两份 `pi-tui`，所以运行时禁止使用 `instanceof Container`。拒绝安装时不改变 method identity 或 component tree，并通过 TUI warning 显示具体拒绝原因，不再静默 fallback。

### 4.2 Managed render

```ts
bridge.reconcile();
originalDoRender.call(tui);
```

实际实现只捕获 `bridge.reconcile()` 的插件错误。发生插件错误时先 restore tree 和 `doRender` identity，再调用 original renderer 一次。

以下行为明确禁止：

- 调用 `terminal.write`。
- 读取或修改 `previousLines`、geometry、viewport 或 cursor baseline。
- 把 force render 降级为普通 render。
- 包装 `requestRender`、`start` 或 `stop`。
- 在原 renderer 抛错后重试 render。

### 4.3 Dispose

`dispose()` 幂等执行：restore tree、删除 instance-own `doRender` wrapper、删除 marker。返回 `deferredAlignment=false`，因此 coordinator 不发额外 force render。

## 5. LiveRegion capacity

令 terminal rows 为 `H`，LiveRegion 后方所有 root/chat components 渲染高度为 `R`，tracked components 完整高度为 `L`。

```text
capacity = max(0, H - R)
visible = suffix(liveLines, capacity)
```

被裁掉的 transient rows 不进入本次原生 frame。状态、editor 和 footer 高度变化会重新计算 capacity，但最终 frame 和 cursor 都由原 renderer 决定。

## 6. Lifecycle

- `session_start`：只 capture TUI；active reload 不接管。
- `agent_start`：reset tracker；安装 patch或进入 fallback。
- message/tool events：只更新 tracker 和 containment flag。
- `agent_end`：dispose、reset、进入 idle；不发额外 render。
- `session_shutdown`：任意 phase 幂等 dispose；不 render、不持久化。

所有 handler 都是同步 no-throw boundary。

## 7. 测试契约

### Tracker/bridge

- parallel completion permutation 只释放最大连续前缀。
- tool id 注册与完成幂等。
- component restore 后对象 identity 不变且数量为一。
- LiveRegion 返回容量内 suffix。
- 普通 text assistant 保持原生位置；thinking/unknown assistant 可切换到 contained。
- tool component 始终 contained。

### Renderer ownership

- active 期间只有 `doRender` 成为 instance-own wrapper。
- `requestRender`、`start`、`stop` identity 保持原生。
- managed render 每次调用 original renderer 恰好一次。
- 插件路径不产生 terminal writes。
- force render 参数原样进入原生 `requestRender`。
- reconcile failure 在原生 render 前恢复 tree 和 method。
- dispose 返回 `deferredAlignment=false`。
- foreign package identity 的结构化 container 可成功建立 bridge。
- unsupported layout 或 foreign renderer owner 会显示 fallback warning。

### Isolation

- lifecycle event snapshots、signals 和 abort state 不变。
- 禁止消息/session/tool/provider API、副作用 timer、watcher、child process。
- idle 和 shutdown 后无 wrapper、LiveRegion 或 tracker state。

### 真实 TUI

必须覆盖：

- 流式输出期间快速 ASCII 输入。
- 中文拼音 composition、候选窗口移动和 commit。
- 多轮连续输入/输出无物理重复。
- parallel tools、expand、resize、abort、shutdown、resume。
- 进程退出码与 stderr crash trace。

真实 TUI 验证的首要门禁是零插件导致的 crash 和重复；`2J/3J` 只作为观察指标，不再作为阻断稳定性修复的绝对门禁。
