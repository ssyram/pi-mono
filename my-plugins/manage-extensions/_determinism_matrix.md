# manage-extensions 设计层 Determinism / Ownership / Coverage 矩阵

目的：不是证明“代码运行时总会走某个分支”，而是检查 **交互设计本身是否在概念层保持确定性（deterministic）**。

也就是说，我们关心的是：

> 在同一个状态里，同一个用户输入，是否只属于一个概念动作；
> 如果一个输入在概念上同时声称属于两个动作，只是代码用分支顺序抢先执行其中一个，那仍然算设计层 non-det。

---

## 0. 检查依据

源码来源：
- `my-plugins/manage-extensions/extension-list.ts`
- `my-plugins/manage-extensions/key-map.ts`
- `my-plugins/manage-extensions/command.ts`
- `packages/tui/src/keybindings.ts`
- `packages/coding-agent/src/core/keybindings.ts`

当前真实 keybinding / 物理键来源：
- `tui.select.cancel` → 默认 `escape` / `ctrl+c`
- `tui.select.confirm` → 默认 `enter`
- `tui.select.up` → 默认 `up`
- `tui.select.down` → 默认 `down`
- `tui.input.tab` → 默认 `tab`
- `left` → 物理左方向键
- `right` → 物理右方向键
- `shift+tab` → 物理 `shift+tab`
- `space` → 物理空格

当前组件在启动时还会额外做一轮 **state-local binding conflict scan**：
- 检查同一个 `focus` 状态中，不同概念动作是否共享同一个物理键
- 对标准 TUI binding 使用真实解析结果
- 对 `left/right/shift+tab/space` 这类插件内直匹配键，直接按物理键名参与扫描
- 若存在冲突，在 panel status/context 中给出摘要提示

---

## 1. 状态语义声明

先不看代码分支，而先看每个状态**应该承载什么用户任务**。

| 状态 | 主要用户任务 | 不该承载的任务 |
|---|---|---|
| `list` | 搜索扩展、浏览列表、选中一个扩展、进入 scope 编辑 | 不该直接编辑 L/G scope |
| `scope` | 编辑当前选中扩展的 `L/G` scope | 不该同时承担搜索输入编辑 |
| `actions` | 在底部动作栏里移动并激活操作 | 不该同时承担列表搜索或 scope 编辑 |

### 设计层结论
这三个状态的职责现在已经被明确分区：
- `list` = 搜索/浏览
- `scope` = L/G 编辑
- `actions` = 动作执行

这是当前系统保持设计层 det 的根基。

---

## 2. 输入 Ownership 矩阵

这里的“ownership”指：**某个输入在某个状态下，概念上归谁解释。**

### 2.1 保留输入集合

- `cancel`
- `confirm`
- `up`
- `down`
- `tab`
- `backTab`
- `left`
- `right`
- `toggleOrActivate`
- `text/edit input`（普通输入、退格、输入框左右、粘贴、删除等）
- `other`

---

### 2.2 Ownership 总矩阵

| 输入类 | `list` | `scope` | `actions` |
|---|---|---|---|
| `cancel` | 外层状态机 | 外层状态机 | 外层状态机 |
| `confirm` | 外层状态机 | 外层状态机 | 外层状态机 |
| `up` | 外层状态机 | 外层状态机 | 无 |
| `down` | 外层状态机 | 外层状态机 | 无 |
| `tab` | 外层状态机 | 外层状态机 | 外层状态机 |
| `backTab` | 外层状态机 | 外层状态机 | 外层状态机 |
| `left` | **搜索输入框** | 外层状态机 | 外层状态机 |
| `right` | **搜索输入框** | 外层状态机 | 外层状态机 |
| `toggleOrActivate(space)` | 搜索输入框 / 普通字符流 | 外层状态机 | 外层状态机 |
| `text/edit input` | 搜索输入框 | 无 | 无 |
| `other` | 搜索输入框尝试消费，否则无效果 | 无效果 | 无效果 |

### 设计层结论
最关键的一行是：

- `left/right` 在 `list` 中**属于搜索输入框**
- `left/right` 在 `scope` / `actions` 中**属于外层状态机**

这正是旧设计层 non-det 的修复核心：
**同一个状态内，不再有“左右键既属于输入框又属于 scope 编辑”的双重归属。**

---

## 3. 逐状态概念动作矩阵

下面不只写“代码怎么走”，而写“每个输入在该状态的概念动作是什么”。

---

### 3.1 `list` 状态矩阵

状态语义：
> 用户正在搜索/浏览扩展列表；此时还没有进入 L/G 编辑态。

| 输入 | Guard | 概念动作 | Next State | Owner | 设计层是否唯一 |
|---|---|---|---|---|---|
| `cancel` | 搜索非空 | 清空搜索 | `list` | 外层 | 是 |
| `cancel` | 搜索为空 且 `cancelArmed=false` | 进入“二次确认退出”预备态 | `list` | 外层 | 是 |
| `cancel` | 搜索为空 且 `cancelArmed=true` | 退出面板 | done(cancel) | 外层 | 是 |
| `confirm` | 有选中项 | 进入 scope 编辑态 | `scope` | 外层 | 是 |
| `confirm` | 无选中项 | 报错：No extension selected | `list` | 外层 | 是 |
| `up` | 有列表项 | 选择上一项 | `list` | 外层 | 是 |
| `down` | 有列表项 | 选择下一项 | `list` | 外层 | 是 |
| `tab` | 总是 | 进入 actions | `actions` | 外层 | 是 |
| `backTab` | 总是 | 进入 actions | `actions` | 外层 | 是 |
| `left` | 总是 | 编辑搜索框光标左移 | `list` | 输入框 | 是 |
| `right` | 总是 | 编辑搜索框光标右移 | `list` | 输入框 | 是 |
| `toggleOrActivate(space)` | 总是 | 作为字符/输入行为进入搜索框 | `list` | 输入框 | 是 |
| `text/edit input` | 总是 | 修改搜索内容并重新过滤 | `list` | 输入框 | 是 |

#### 设计层判定
`list` 现在是 **det** 的，原因：
- 进入 scope 的唯一入口是 `confirm`
- scope 编辑键 (`left/right/space`) 不再在此状态承担第二语义
- 搜索输入键全部留给输入框

#### 与旧设计的差异
旧版的核心 non-det 就在于：
- `left/right` 同时属于“输入框光标移动”和“scope 选择”

当前版已消除。

---

### 3.2 `scope` 状态矩阵

状态语义：
> 用户正在编辑当前选中项的 scope（Local / Global）。

| 输入 | Guard | 概念动作 | Next State | Owner | 设计层是否唯一 |
|---|---|---|---|---|---|
| `cancel` | 总是 | 退出 scope 编辑，回列表 | `list` | 外层 | 是 |
| `confirm` | 总是 | 退出 scope 编辑，回列表 | `list` | 外层 | 是 |
| `tab` | 总是 | 跳到 actions | `actions` | 外层 | 是 |
| `backTab` | 总是 | 跳到 actions | `actions` | 外层 | 是 |
| `up` | 有列表项 | scope 模式下选上一项 | `scope` | 外层 | 是 |
| `down` | 有列表项 | scope 模式下选下一项 | `scope` | 外层 | 是 |
| `left` | `column=1` | 选择 Local | `scope` | 外层 | 是 |
| `left` | `column=0` | 保持 Local，并提示 already selected | `scope` | 外层 | 是 |
| `right` | `column=0` | 选择 Global | `scope` | 外层 | 是 |
| `right` | `column=1` | 保持 Global，并提示 already selected | `scope` | 外层 | 是 |
| `toggleOrActivate(space)` | 有选中项 | toggle 当前列 scope | `scope` | 外层 | 是 |
| `text/edit input` | 总是 | 无动作 | `scope` | 无 | 是 |

#### 设计层判定
`scope` 现在也是 **det** 的，原因：
- 该状态不再让搜索输入框参与判键
- 左右键只承担 `L/G` 选择语义
- `space` 只承担 toggle 语义
- `confirm/cancel` 只承担“退出 scope 编辑”语义

#### 边界体验
- 左边再按左：`Local already selected`
- 右边再按右：`Global already selected`

这不是 determinism 必需条件，但能避免“det 但无反馈”的 UX 问题。

---

### 3.3 `actions` 状态矩阵

状态语义：
> 用户正在底部动作栏里移动并执行操作。

| 输入 | Guard | 概念动作 | Next State | Owner | 设计层是否唯一 |
|---|---|---|---|---|---|
| `cancel` | 总是 | 回列表 | `list` | 外层 | 是 |
| `tab` | 总是 | 回列表 | `list` | 外层 | 是 |
| `backTab` | 总是 | 回列表 | `list` | 外层 | 是 |
| `left` | 总是 | 动作栏左移 | `actions` | 外层 | 是 |
| `right` | 总是 | 动作栏右移 | `actions` | 外层 | 是 |
| `confirm` | 当前 action=apply 且可执行 | 应用变更 | done(apply) | 外层 | 是 |
| `confirm` | 当前 action=apply 且不可执行 | 显示不能 apply 的原因 | `actions` | 外层 | 是 |
| `confirm` | 当前 action=list | 回列表 | `list` | 外层 | 是 |
| `confirm` | 当前 action=cancel | 退出面板 | done(cancel) | 外层 | 是 |
| `toggleOrActivate(space)` | 与 `confirm` 同义 | 激活当前 action | 同上 | 外层 | 是 |
| `text/edit input` | 总是 | 无动作 | `actions` | 无 | 是 |

#### 设计层判定
`actions` 也是 **det** 的：
- 左右只导航动作栏
- Enter / Space 只激活动作
- Tab / Shift+Tab / Esc 只返回 list

这里不存在 scope 编辑或搜索输入竞争。

---

## 4. Conceptual Non-Det 检查矩阵

这一节专门检查：

> 同一个状态里，同一个输入，是否在概念上属于两个动作。

### 4.1 默认绑定检查表

| 状态 | 输入 | 概念动作 A | 概念动作 B | 是否冲突 | 结果 |
|---|---|---|---|---|---|
| `list` | `left` | 搜索框光标左移 | 选择 Local | 旧版冲突，现已移除 | ✅ |
| `list` | `right` | 搜索框光标右移 | 选择 Global | 旧版冲突，现已移除 | ✅ |
| `list` | `confirm` | 输入框 submit | 进入 scope 编辑 | 通过外层保留 `confirm`，输入框不接管 | ✅ |
| `list` | `cancel` | 输入框 escape | 清搜索 / 预备退出 / 退出 | 外层统一接管 | ✅ |
| `scope` | `left/right` | L/G 选择 | 搜索框光标移动 | 搜索框已失焦 | ✅ |
| `scope` | `space` | toggle scope | 输入字符空格 | 搜索框已失焦 | ✅ |
| `actions` | `space` | 激活动作 | 输入字符空格 | 无输入框参与 | ✅ |
| `actions` | `left/right` | 动作栏导航 | scope 选择 | 状态分区后互斥 | ✅ |

### 4.2 用户重映射冲突检查

当前实现新增了运行时冲突扫描：

- `findBindingConflicts(keybindings)`
- 对 `list` / `scope` / `actions` 分别建立“概念动作 -> 键集合”映射
- 标准 TUI 键通过 `keybindings.getKeys(...)` 解析
- 插件自己直匹配的键（`left/right/shift+tab/space`）直接按物理键名参与冲突扫描
- 若同一状态中两个不同概念动作解析出同一个物理键，则记为冲突

例如，若用户把：
- `tui.select.confirm = space`

则在 `scope` 中会出现：
- `back to list = space`
- `toggle scope = space`

这种冲突会被扫描并在 UI 上提示。

### 结论
从设计层看，当前主状态机已经没有明显的**默认绑定下的概念性 non-det**；并且对用户重映射引入的同态冲突，已有面板内提示机制。

---

## 5. Guard 细化矩阵（实现 det 的必要条件）

虽然设计层目标是“同状态单义”，但某些动作仍受 guard 控制。下面把 guard 条件写清楚，防止把 guard 误当成冲突。

| 状态 | 输入 | Guard | 结果 A | 结果 B | 是否构成 non-det |
|---|---|---|---|---|---|
| `list` | `cancel` | 搜索非空 vs 搜索为空 | clear search | arm/exit | 否，guard 互斥 |
| `list` | `cancel` | `cancelArmed=false` vs `true` | arm cancel | done(cancel) | 否，guard 互斥 |
| `list` | `confirm` | 有无选中项 | enter scope | status error | 否，guard 互斥 |
| `scope` | `left` | 当前列是否已 Local | 切到 Local | status already selected | 否，guard 互斥 |
| `scope` | `right` | 当前列是否已 Global | 切到 Global | status already selected | 否，guard 互斥 |
| `actions` | `confirm/space` | 当前 action | apply/list/cancel 三分支 | - | 否，actionIndex 唯一 |
| `actions` | `confirm/space` | apply 可执行否 | apply | status error | 否，guard 互斥 |

### 结论
这些 guard 只是在**一个概念动作内部做条件分流**，而不是让一个输入在同状态下属于两个不同概念动作，因此不构成设计层 non-det。

---

## 6. Help Coverage 矩阵

这一节检查：

1. 文案里提到的键，是否真的有该行为
2. 真正可用的重要动作，是否都被文案覆盖
3. 是否存在“隐藏路径”未被文案说明

---

### 6.1 `list` 帮助覆盖

当前帮助（无搜索词，未 armed）：
- `Type search`
- `up/down move`
- `enter edit scope`
- `tab/shift+tab actions`
- `escape/ctrl+c arm cancel`

当前帮助（无搜索词，已 armed）：
- `Type search`
- `up/down move`
- `enter edit scope`
- `tab/shift+tab actions`
- `escape/ctrl+c exit`

当前帮助（有搜索词）：
- `Type search`
- `up/down move`
- `enter edit scope`
- `tab/shift+tab actions`
- `escape/ctrl+c clear`

| 实际动作 | 文案覆盖 | 结果 |
|---|---|---|
| 搜索输入 | `Type search` | ✅ |
| 上下移动 | `up/down move` | ✅ |
| Enter 进入 scope 编辑 | `enter edit scope` | ✅ |
| Tab 进入 actions | `tab/shift+tab actions` | ✅ |
| Shift+Tab 进入 actions | `tab/shift+tab actions` | ✅ |
| Esc/Ctrl+C 清搜索 | `clear` | ✅ |
| Esc/Ctrl+C 第一次 arm cancel | `arm cancel` | ✅ |
| Esc/Ctrl+C 第二次退出 | `exit` | ✅ |

---

### 6.2 `scope` 帮助覆盖

当前帮助：
- `up/down move`
- `left/right choose L/G`
- `space toggle`
- `enter/escape/ctrl+c list`
- `tab/shift+tab actions`

| 实际动作 | 文案覆盖 | 结果 |
|---|---|---|
| 上下移动 | ✅ | ✅ |
| 左右选 L/G | ✅ | ✅ |
| Space toggle | ✅ | ✅ |
| Enter 返回 list | ✅ | ✅ |
| Esc/Ctrl+C 返回 list | ✅ | ✅ |
| Tab/Shift+Tab 去 actions | ✅ | ✅ |

结论：无隐藏出口。

---

### 6.3 `actions` 帮助覆盖

当前帮助：
- `left/right move`
- `enter/space activate`
- `tab/shift+tab/escape/ctrl+c list`

| 实际动作 | 文案覆盖 | 结果 |
|---|---|---|
| 左右切 action | ✅ | ✅ |
| Enter 激活 | ✅ | ✅ |
| Space 激活 | ✅ | ✅ |
| Tab 返回 list | ✅ | ✅ |
| Shift+Tab 返回 list | ✅ | ✅ |
| Esc/Ctrl+C 返回 list | ✅ | ✅ |

结论：原先漏写 `space activate` 的问题已修正。

---

## 7. 设计层不变量（Invariants）

下面这些可以视为当前状态机的设计层不变量：

### I1. `list` 中，任何会被 `searchInput` 编辑语义消费的键，不得再承担 scope 编辑语义
这是最关键的不变量。

### I2. `scope` 中，搜索输入框不得参与判键
否则 `left/right/space/enter/esc` 都可能重新引入概念冲突。

### I3. `actions` 中，只有动作栏在解释左右和激活键
不允许列表或 scope 语义泄漏进来。

### I4. 所有“模式切换键”必须在帮助文案中出现
尤其是：
- `tab`
- `backTab`
- `cancel`
- `confirm`

### I5. 一个状态中的“退出键”和“激活键”不能概念重叠
例如不能让同一个键既代表“完成编辑返回上层”，又代表“toggle 当前项”，除非两者本来就是同一概念动作。

### I6. 列表区域高度应保持稳定，不因结果数量变化导致整体 panel 高度抖动
当前实现已通过固定 list 区行数、结果不足时补空行来满足该条件。

---

## 8. 本轮 model-check 找到并已修复的问题

| 问题 | 类型 | 处理结果 |
|---|---|---|
| `list` 中，任何会被 `searchInput` 编辑语义消费的键，不得再承担 scope 编辑语义 | help/ownership | 已通过 `scope` 独立状态 + list 中左右/空格不承担 scope 语义修复 |
| `scope` / `actions` 所用左右/空格/shift+tab 不应依赖修改标准版 pi 源码注册额外 binding id | 运行环境兼容性 | 已改为插件内直接匹配物理键 |
| `ListResult["back"]` 不可达，命令层 still-loop 为死分支 | 状态模型残留 | 已删除 `back`，简化命令层控制流 |
| plain list help 只写 `cancel`，未表达二段式退出 | help coverage 缺失 | 已改为 `arm cancel` / `exit` |
| panel 高度只是 bounded，不是 strict fixed | 布局稳定性 | 已把 list 区固定为 `visibleRows`，不足时补空行，并始终显示 indicator 行 |
| 用户自定义 keybinding 可重新制造概念冲突 | 设计层风险 | 已加入 state-local binding conflict scan 与 UI 提示 |
| README 未完整覆盖 refined 状态机 | 文档残留 | 仍需同步 README 文案 |

---

## 9. 当前仍然剩余的风险

### R1. keybinding 冲突当前是“运行时提示”，不是“硬阻止”
现在如果用户重映射造成冲突：
- 面板会提示冲突摘要
- 但不会强制禁止继续操作

这已经比之前强很多，但如果未来要更硬，可以升级为：
- apply 前阻止
- 或在命令启动前直接 fail-fast

### R2. panel 高度仍受终端高度预算约束
虽然列表区现在在其预算内是固定高度，
但整个组件仍依赖：
- `process.stdout.rows || 24`

如果未来宿主提供真实 height，仍建议升级为宿主传 height，而不是插件侧估算。

---

## 10. 最终结论

### 10.1 当前是否仍有设计层 non-det？
**就默认绑定与当前状态机设计而言，没有。**

### 10.2 为什么可以这么说？
因为当前设计已经把三类任务拆开：
- `list`：搜索/浏览
- `scope`：L/G 编辑
- `actions`：动作栏执行

并且最危险的冲突键已经完成状态隔离：
- `left/right` 不再在 `list` 中承担 scope 语义
- `enter` 不再既想 submit 输入又想 toggle scope
- `tab/shift+tab` 的模式跳转在各状态里都已显式化

### 10.3 当前帮助文案是否覆盖了真实行为？
**是，当前主导航动作已全部覆盖。**

### 10.4 还缺什么才算“更强的 model checking”？
如果要再更严格，应补两项：

1. **自动化状态机测试**
   - 对每个状态的关键输入做 transition assertions

2. **keybinding 重映射冲突测试**
   - 验证用户自定义绑定不会把两个概念动作重新绑到同一个物理键上

---

## 11. 一句话摘要

当前 `manage-extensions` 的关键改进，不只是“代码分支顺序能跑通”，而是：

> **通过把搜索浏览、scope 编辑、actions 执行拆成互斥状态，并重新分配输入 ownership，消除了原先最大的概念性 non-det；同时新增了对用户重映射冲突的状态内扫描。**
