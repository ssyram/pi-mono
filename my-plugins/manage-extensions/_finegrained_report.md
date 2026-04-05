# finegrained-check: manage-extensions 人工可用性审查（2025-02 修订）

## Phase 0 — 检查范围

纳入范围：

- `my-plugins/manage-extensions/extension-list.ts`
- `my-plugins/manage-extensions/types.ts`
- `my-plugins/manage-extensions/key-map.ts`
- `my-plugins/manage-extensions/command.ts`
- `my-plugins/manage-extensions/README.md`
- `packages/tui/src/tui.ts`（只用于确认组件层 viewport 约束）

本轮目标聚焦在**人工可用性**，尤其是：

1. 搜索输入与列表横向作用域选择的键位冲突
2. 列表区域被底部信息挤压、可见区不稳定、顶部内容容易掉出视口

---

## Phase 1 — 原子命题

### 交互 / 焦点模型

- **P1** `extension-list.ts` 初始时 `searchInput.focused = true`，列表页默认把搜索框保持为焦点实体。
- **P2** `extension-list.ts` 原实现只有 `Focus = "list" | "actions"`，不存在独立的 scope picking 子模式。
- **P3** 原实现中，list 模式同时承担：搜索输入、上下移动、左右切换 L/G、空格/回车 toggle。
- **P4** `README.md` 公开文档也把 `Type` 搜索、`←/→` 切 L/G、`Enter/Space` toggle 写成同层交互契约，而非 bug。
- **P5** `key-map.ts` 已走统一 keybinding 系统，因此本轮问题不是“按键没抽象”，而是“状态机语义没分层”。

### Esc / Enter 语义

- **P6** 原实现 `Esc` 优先级是：清空搜索 > 从 action bar 回到 list > 两次退出。
- **P7** 原实现 `Enter` 在 list 模式直接执行 toggle，和“进入更细粒度 scope 选择”需求冲突。

### 视口 / 滚动模型

- **P8** 原实现把列表可见窗口硬编码为 `visible = 20`。
- **P9** 原实现每次 render 都按 `selectedIndex` 重新推导 `start/end`，没有稳定 `scrollOffset`。
- **P10** 同一页面底部还堆叠 path、scope hint、pending、preflight issues、action bar、status、help 等动态高度块。
- **P11** `packages/tui/src/tui.ts` 的 `Component.render()` 只拿到 `width`，拿不到 `height`。
- **P12** `packages/tui/src/tui.ts` 内部把可见 viewport 视为“总输出的底部 N 行”，所以一旦页面总行数超高，顶部更容易丢失。

---

## Phase 2 — 矛盾与遗漏检查

### 高严重度

1. **搜索输入与横向 scope 选择耦合**
   - P1 + P3 + P4 共同形成直接冲突：
   - 用户一边被鼓励“随时搜索”，一边左右键又被 TUI 用来切 L/G。
   - 结果是输入框编辑语义与列表横向选择语义冲突，属于核心可用性缺陷。

2. **列表高度固定、页面高度动态**
   - P8 + P10 + P12 冲突。
   - 列表假定能稳定占 20 行，但页面总高度并不受控，TUI 又按底部视口裁剪。
   - 结果是列表上部更容易被挤出可见区，用户上下移动时产生“视口跳动 / 顶部消失”体验。

### 中严重度

3. **缺少 scope picking 子模式**
   - P2 + P7 构成设计遗漏。
   - 视觉上虽然有 L/G token，但交互上没有进入/退出该点位的明确阶段，导致 Enter、Esc、左右键都难以定义得一致。

4. **滚动状态不稳定**
   - P9 导致滚动由“选中项位置”隐式推导，而不是一个明确的滚动偏移。
   - 结果是用户感知到的是页面在跳，而不是光标在稳定移动。

### 低严重度

5. **README 与期望的人工操作模型不一致**
   - P4 表明 README 会在修复后过时，若不同步会造成文档-实现偏差。

---

## Phase 3 — 设计点交叉覆盖矩阵

| 设计点 | 搜索输入 | 行选择 | L/G 选择 | Toggle | Esc 退出 | Action bar | 视口高度 | 滚动稳定 |
|---|---|---|---|---|---|---|---|---|
| 搜索输入 | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |
| 行选择 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| L/G 选择 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Toggle | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Esc 退出 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Action bar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 视口高度 | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |
| 滚动稳定 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### 主要空洞

- **搜索输入 × L/G 选择 = ✗**：当前同层竞争左右键。
- **搜索输入 × Toggle = ✗**：Enter/Space 既像输入确认，又像 toggle。
- **L/G 选择 × 视口高度 = ✗**：焦点提示与底部说明会继续压缩列表空间。
- **Toggle × 视口高度 = ✗**：每次状态变化引发重绘，但列表可见区没有跟随总高度稳定调整。

---

## Phase 4 — 结论与修复方案

### 关键问题

1. **核心交互状态机过于扁平**
   - 需要把“浏览列表”和“选择作用域”拆成两个模式。

2. **页面总高度未受控**
   - 需要根据终端可用高度动态分配列表区，而不是固定 20 行。

3. **滚动缺少持久 offset**
   - 需要稳定 scroll offset，确保选中项只在必要时推动视口。

### 采用方案

#### 方案 A：引入第三种焦点 `scope`

- 焦点从 `list | actions` 升级为 `list | scope | actions`
- `list` 只负责：搜索、上下移动、Tab 去 action bar、Enter 进入 scope
- `scope` 只负责：左右选择 L/G、Space toggle、Enter/Esc 退出
- `actions` 保持底部按钮导航

#### 方案 B：引入稳定滚动偏移与动态列表高度

- 新增 `scrollOffset`
- 使用 `process.stdout.rows || 24` 估算当前终端高度
- 先计算 header/footer 占用，再得出 list row budget
- 若列表被截断，则保留 1 行显示 `(selected/total)` 指示
- 保证总输出尽量不超过终端高度，避免 TUI 底部裁剪吞掉顶部内容

#### 方案 C：同步文档

- 更新 README，使其反映新的 scope picker 交互模型

---

## 已执行修复摘要

- `types.ts`：新增 `scope` 焦点
- `extension-list.ts`：
  - 引入 `scrollOffset`
  - 引入 `focusScope()`
  - 把左右键从 list 模式移除
  - Enter 在 list 模式改为“进入 scope picker”
  - Space 只在 scope 模式下 toggle
  - Esc 在 scope/actions 下先退出到 list
  - 根据终端高度动态分配列表区
- `README.md`：更新键位说明

---

## 风险与后续建议

- 当前高度仍是插件侧基于 `process.stdout.rows` 的估算，不是 TUI 框架正式下发的高度。
- 若未来想从根上解决这类问题，可考虑把 `Component.render(width)` 升级为 `render(width, height)`。
- 若后续仍有长 path / 多 issue 挤压列表的情况，可进一步把详情块改为折叠式摘要。
