# 状态栏拥挤与 oh-my-pi tasks 机制调查

## 结论
- **不是 pi-tui 底层只能一行。** `pi-tui` 组件本身支持 `render(width): string[]`，天然支持多行。
- **但 coding-agent 当前内置 footer 对扩展状态 (`setStatus`) 的实现，确实只有一条扩展状态行。**
- 所有插件的 `ctx.ui.setStatus(...)` 都会被汇总到这一条里，**按 key 排序后拼成单行，再截断**。
- 因此你现在看到的 `impression:data / impression / ctx / omp-jobs ...` 挤在一起，**是当前 footer 实现决定的，不是单个插件异常。**

## 关键证据
### 1) 当前 footer 的真实行为
文件：`packages/coding-agent/src/modes/interactive/components/footer.ts`
- built-in footer 整体并非只有 1 行；它本身会渲染：
  1. `pwdLine`
  2. `statsLine`
  3. `extension status line`（可选）
- **扩展状态区只有 1 行**：
  - 读取 `getExtensionStatuses()`
  - 排序
  - `join(" ")`
  - `truncateToWidth(...)`
- `sanitizeStatusText()` 会把换行、tab 都压成空格，所以扩展**无法靠 `setStatus` 自己做多行**。

### 2) `setStatus` 的官方语义
文件：
- `packages/coding-agent/docs/rpc.md`
- `packages/coding-agent/docs/tui.md`
- `packages/coding-agent/docs/extensions.md`

结论：`setStatus` 明确就是 **footer/status bar 持久摘要**，不是多行面板。

### 3) 当前拥挤来源
- `my-plugins/impression/index.ts`
  - `impression-data`
  - `impression-distill`
- `my-plugins/show-sys-prompt.ts`
  - `ctx-chars`
- `my-plugins/oh-my-pi/index.ts`
  - `omp-jobs`
- `my-plugins/oh-my-pi/hooks/custom-compaction.ts`
  - `omp-compact`
- `my-plugins/oh-my-pi/hooks/boulder-countdown.ts`
  - countdown 状态

这些都走 `ctx.ui.setStatus(...)`，所以天然竞争同一条状态行。

## 你当前配置里的直接原因
文件：`.pi/impression.json`

当前值：
```json
{
  "skipDistillation": [],
  "showData": true,
  "debug": true,
  "minLength": 1792
}
```

其中最直接的拥挤来源：
- `showData: true`：会常驻显示 `impression-data`
- `debug: true`：会增加调试/提示噪音
- `minLength: 1792`：阈值偏低，会更频繁触发 impression 相关行为

## oh-my-pi 的 tasks 目前怎么显示
文件：`my-plugins/oh-my-pi/index.ts`

`oh-my-pi` 实际用了两套机制：
- `ctx.ui.setStatus("omp-jobs", ...)`：**单行摘要**，进 footer
- `ctx.ui.setWidget("omp-tasks", lines)`：**多行 widget**，独立显示任务列表

`omp-tasks` 的特点：
- 传入的是 `string[]`
- 有标题行 `Tasks (N active, D/T done)`
- 每个任务一行
- 最多显示 10 条，超出显示 `... N more`
- 无任务时隐藏

### 判断
- **可行。** `oh-my-pi tasks` 这套机制本质上就是“结构化信息不要继续塞进 status，而是用独立多行 widget”。
- 但它更适合：
  - 任务列表
  - 有状态的结构化条目
  - 数量有限、可排序的信息
- 不太适合把所有零碎 status 原样平移过去。

## 建议
### 立刻可做
1. 把 `.pi/impression.json` 里的 `showData` 改成 `false`
2. 如无必要，把 `debug` 改成 `false`
3. 适当提高 `minLength`
4. 若 `ctx` 统计不是刚需，减少或关闭 `show-sys-prompt` 的状态显示

### 更合理的 UI 方案
#### 方案 A：保留 status 只放摘要
- footer 只留极少数高优先级项，例如：
  - `omp-jobs`
  - 一个简短的 `ctx`
  - 一个简短的 `impression`
- 详细数据改走 widget

#### 方案 B：借用 oh-my-pi tasks/widget 思路
- 把 `impression:data`、详细 `ctx`、压缩状态等迁到 **独立 widget**
- footer 只保留一句摘要
- 这是**最小改动且最符合现有架构**的方案

#### 方案 C：直接替换默认 footer
文件：`packages/coding-agent/examples/extensions/custom-footer.ts`
- 可用 `ctx.ui.setFooter()` 完整替换 built-in footer
- 可读取 `footerData.getExtensionStatuses()` 后**自行分组/分两行/筛选**
- 这是控制力最强的方案，但实现成本高于 widget

## 最终判断
- **“customised 的状态栏是不是只能一行？”**
  - 若你说的是 **当前 built-in footer 里的扩展状态区**：**是，实际上就是单行聚合+截断。**
  - 若你说的是 **整个 TUI 能力**：**不是，底层支持多行。**
- **解决拥挤的正确方向**不是继续往 `setStatus` 里塞，而是：
  1. 先减项
  2. 再把结构化信息迁到 `setWidget`
  3. 如果要彻底重做，再上 `setFooter()`
