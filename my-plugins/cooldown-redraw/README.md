# cooldown-redraw

Pi 扩展插件，抑制 TUI 在流式输出期间的全屏重绘（弹跳/闪烁）。

## 问题

Pi 的 TUI 使用 line-based differential rendering。当 streaming token 导致 markdown reflow 改变了视口上方的行时，渲染器检测到 `firstChanged < prevViewportTop`，触发 `fullRender(true)` —— 清除整个屏幕（含 scrollback）并重写所有内容。这在快速流式输出时每秒发生多次，表现为屏幕上下弹跳。

## 方案

在 agent 运行期间，将 `firstChanged < prevViewportTop` 分支从"全清重写"改为"clamp 到视口顶部"—— 丢弃视口上方的变化，只 diff 更新可见区域内的行。

加入 cooldown 机制：每隔一段时间（默认 10s）放行一次 fullRender，修正累积的视觉偏差。

## 实现方式

完整 fork 了 `TUI.prototype.doRender`（来自 `@earendil-works/pi-tui v0.75.1`），修改了一个分支。通过 monkey-patch 替换 TUI 实例的 `doRender` 方法。

## 配置

在 `~/.pi/agent/settings.json`（全局）或 `.pi/settings.json`（项目级，优先）中添加：

```json
{
  "cooldownRedraw": {
    "enabled": true,
    "intervalMs": 10000
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用插件 |
| `intervalMs` | number | `10000` | cooldown 间隔（ms），期间抑制 fullRender；过期后放行一次 |

不配置时使用默认值（启用，10s cooldown）。

## 生命周期

| 事件 | 行为 |
|------|------|
| `session_start` | 通过 `ctx.ui.custom()` 获取 TUI 实例，挂载 patched doRender |
| `agent_start` | 激活 cooldown 模式，开始抑制 |
| `agent_end` | 停用 cooldown，触发一次 force render 对齐最终状态 |
| `session_shutdown` | 恢复原始 doRender |

Agent 未运行时，渲染行为与原始完全一致。

## 不抑制的情况

- 终端 resize（宽度/高度变化）—— 必须全量重绘，否则内容错位
- 首次渲染
- cooldown 过期后的第一次触发 —— 放行修正偏差
- `clearOnShrink` 触发（默认关闭）

## 文件结构

```
cooldown-redraw/
├── index.ts              barrel export
├── cooldown-redraw.ts    extension entry，lifecycle hooks
├── config-and-state.ts   配置加载，globalThis 状态管理
└── forked-do-render.ts   完整 doRender fork（唯一修改标记为 COOLDOWN PATCH）
```

## 维护：升级 pi-tui 后如何同步

`forked-do-render.ts` 是 `@earendil-works/pi-tui` 中 `TUI.prototype.doRender` 的完整拷贝。升级 pi-tui 后必须检查是否需要同步。

1. 对比上游变化：
   ```bash
   diff <(sed -n '/doRender()/,/^    }/p' \
     node_modules/@earendil-works/pi-tui/dist/tui.js) \
     <(sed -n '/FORK START/,/FORK END/p' \
     my-plugins/cooldown-redraw/forked-do-render.ts)
   ```

2. 将上游新增/修改的逻辑同步到 fork 中。

3. **不要动** `COOLDOWN PATCH` 标记的代码块 —— 那是唯一的有意差异。

4. 更新文件头部的 `Synced from: @earendil-works/pi-tui vX.Y.Z` 版本号。

## 已知限制

- 视口上方被 clamp 的行保持旧内容。由于 pi 是 bottom-anchored 且无用户向上滚动功能，这些行不会再被看到，无可见副作用。
- 如果未来 pi 加入向上滚动功能，需要在滚动时触发一次 fullRender 来修正上方内容。
- 与其他 monkey-patch `doRender` 的插件互斥（目前生态中不存在这样的插件）。
