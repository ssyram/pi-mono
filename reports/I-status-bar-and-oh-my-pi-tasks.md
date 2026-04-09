# 状态栏修改计划

## 问题
- 当前 built-in footer 的「扩展状态区」把所有 `ctx.ui.setStatus()` 的内容按 key 排序 `join(" ")` 拼成**一行**再截断。`sanitizeStatusText` 会把 `\n \t` 全压成空格，所以扩展**无法**用换行撑成多行。
- 证据：`packages/coding-agent/src/modes/interactive/components/footer.ts`、`core/footer-data-provider.ts`
- 当前挤在一起的来源：`impression-data` / `impression-distill` / `ctx-chars` / `omp-jobs` / `omp-compact` / boulder 倒计时

## 能做什么
pi-tui 本身支持多行、overlay、右侧锚点。仓库里已经有现成的右侧侧栏示例：`packages/coding-agent/examples/extensions/overlay-qa-tests.ts` 中的 `/overlay-sidepanel`，用的就是 `ctx.ui.custom(..., { overlay: true, overlayOptions: { anchor: "right-center", width: "25%", minWidth: 30, margin: { right: 1 }, visible: w => w >= 100 } })`。

三条通道的定位：
- `setStatus` — footer 单行摘要，只适合临时/短信息
- `setWidget` — editor 上方或下方的多行块，placement 只有 `aboveEditor | belowEditor`，硬上限 10 行（`MAX_WIDGET_LINES`），**不能放右侧**
- `ctx.ui.custom` + `overlay: true` — 可锚 9 个位置（含 `right-center / top-right / bottom-right`），支持百分比宽度、`nonCapturing`、`visible(termWidth)`，**这就是右侧常驻面板的唯一路径**

## 分层
- **右侧常驻 overlay（新增）**：`ctx` 概览、`impression:data`、compact 统计、jobs 摘要、分支/模型/会话等长期指标
- **footer status**：只留临时工作态，例：`distilling...`、当前 turn、瞬时告警
- **notify**：一次性事件（完成/失败/重要变化）

## 立刻可做（零代码，改配置）
改 `.pi/impression.json`：
- `showData: true` → `false`
- `debug: true` → `false`
- `minLength: 1792` → 适度调高

这一步先把拥挤降下来，不解决结构问题。

## 结构方案（新写一个 extension，不碰既有插件）
新插件职责：
1. 监听每个永久信息源的事件（或直接读 `footerData.getExtensionStatuses()` 拿到已有 status）
2. 组装一个多行 `Component`，用 `ctx.ui.custom(factory, { overlay: true, overlayOptions })` 渲染到右侧
3. `anchor: "right-center"`（或 `top-right`），`width: "25%"`，`minWidth: 30`，`nonCapturing: true`，窄终端 `visible` 返回 false
4. 通过 `onHandle` 拿 `OverlayHandle`，后续更新用重建 + `setHidden` 控制显隐
5. 把 `impression` / `show-sys-prompt` / `oh-my-pi` 里那些**永久性** `setStatus` 改成 `setStatus(key, undefined)` 清掉，内容改由新插件统一展示
6. footer 只留真正临时的（`impression-distill`、`omp-compact` 这种进行中态、`omp-jobs` 摘要可留可迁）

## 注意点
- overlay 是**合成覆盖**在基础内容上，不是真正的 split pane。主视图不会自动让出右侧空间，**窄终端会覆盖对话内容**，所以 `visible(termWidth)` 阈值要调好（demo 用的是 ≥100）。
- overlay 关闭后组件会销毁，**不能复用旧实例**；更新要么重建，要么 `setHidden`。
- 每行不能超过传入的 `width`，组件自己负责换行/截断。彩色要逐行处理样式。
- `MAX_WIDGET_LINES = 10` 只约束 `setWidget`，不约束 overlay。
