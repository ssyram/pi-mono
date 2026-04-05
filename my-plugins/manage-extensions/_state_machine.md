# manage-extensions 状态机（从当前代码直接抽取）

来源文件：
- `my-plugins/manage-extensions/extension-list.ts`
- `my-plugins/manage-extensions/key-map.ts`
- `packages/tui/src/keybindings.ts`

版本说明：本文描述的是**当前修复后代码**中的真实状态机，而不是设计草图。

---

## 1. 顶层状态

面板级主状态：

- `list`
- `scope`
- `actions`

相关伴随状态：

- `selectedIndex: number`
- `scrollOffset: number`
- `column: 0 | 1`（`0 = Local`, `1 = Global`）
- `actionIndex: 0 | 1 | 2`（`apply | list | cancel`）
- `cancelArmed: boolean`
- `statusMessage: string`
- `searchInput.value: string`
- `filtered: ExtensionState[]`
- `bindingConflicts: BindingConflict[]`

---

## 2. 键位定义（真实绑定）

这些按键不是写死文案，而是来自标准 TUI 键位 + 插件内直接物理键匹配：

- `tui.select.cancel` → 默认 `escape` / `ctrl+c`
- `tui.select.confirm` → 默认 `enter`
- `tui.select.up` → 默认 `up`
- `tui.select.down` → 默认 `down`
- `tui.input.tab` → 默认 `tab`
- `left` → 物理左方向键
- `right` → 物理右方向键
- `shift+tab` → 物理 `shift+tab`
- `space` → 物理空格

组件启动时会额外计算：
- `bindingConflicts = findBindingConflicts(keybindings)`

用于检查**同一状态内是否有两个不同概念动作共享了同一个物理键**。

---

## 3. 全局优先级

`handleInput(data)` 的判定顺序：

1. **先判 cancel**
2. 再按 `focus` 分支：
   - `actions`
   - `scope`
   - `list`
3. 在 `list` 中，如果未命中特殊键，最后才把输入交给 `searchInput.handleInput(data)`

因此：
- `Esc/Ctrl+C` 永远先由外层状态机处理
- `Enter` 在 `list` 中先被解释为“进入 scope 编辑态”
- `Left/Right` 在 `list` 中不会被外层占用，会落到搜索框光标移动
- `Shift+Tab` / `Space` 在当前插件里直接按物理键处理，不依赖修改标准版源码注册额外 keybinding id

---

## 4. 状态转移表

### 4.1 `list`

#### 输入与转移
- `cancel`
  - 若 `searchInput.value !== ""`：清空搜索，留在 `list`
  - 否则若 `cancelArmed = false`：置 `cancelArmed = true`，留在 `list`
  - 否则：`done({ action: "cancel" })`
- `tab` 或 `shift+tab`
  - 转到 `actions`
- `up`
  - `selectedIndex = previous`，留在 `list`
- `down`
  - `selectedIndex = next`，留在 `list`
- `confirm`
  - 若存在选中项：转到 `scope`
  - 否则：`statusMessage = "No extension selected"`，留在 `list`
- 其他输入
  - 交给 `searchInput.handleInput(data)`
  - 重新过滤 `filtered`
  - 留在 `list`

#### 屏幕帮助
- 有搜索词：`Type search · up/down move · enter edit scope · tab/shift+tab actions · escape/ctrl+c clear`
- 无搜索词：
  - 第一次 `Esc/Ctrl+C`：`... · escape/ctrl+c arm cancel`
  - 已 armed 后：`... · escape/ctrl+c exit`

---

### 4.2 `scope`

#### 输入与转移
- `cancel`
  - 转到 `list`
- `tab` 或 `shift+tab`
  - 转到 `actions`
- `up`
  - 选中上一项，留在 `scope`
- `down`
  - 选中下一项，留在 `scope`
- `left`
  - `column = 0`；若本来已是 `0`，则仅显示 `Local already selected`
- `right`
  - `column = 1`；若本来已是 `1`，则仅显示 `Global already selected`
- `space`
  - toggle 当前选中扩展在当前 `column` 对应 scope 的启用状态
- `confirm`
  - 转到 `list`
- 其他输入
  - 无效果，留在 `scope`

#### 屏幕帮助
- `up/down move · left/right choose L/G · space toggle · enter/escape/ctrl+c list · tab/shift+tab actions`

---

### 4.3 `actions`

#### 输入与转移
- `cancel`
  - 转到 `list`
- `tab` 或 `shift+tab`
  - 转到 `list`
- `left`
  - `actionIndex = previous`，留在 `actions`
- `right`
  - `actionIndex = next`，留在 `actions`
- `confirm` 或 `space`
  - 激活当前 action：
    - `apply`
      - 若 `canApply()`：`done({ action: "apply" })`
      - 否则显示错误消息并留在 `actions`
    - `list`
      - 转到 `list`
    - `cancel`
      - `done({ action: "cancel" })`
- 其他输入
  - 无效果，留在 `actions`

#### 屏幕帮助
- `left/right move · enter/space activate · tab/shift+tab/escape/ctrl+c list`

---

## 5. 输出动作

面板只会向命令层输出两种结果：

- `{ action: "apply" }`
- `{ action: "cancel" }`

命令层 `command.ts` 的外层流程是：

1. 扫描扩展
2. 进入列表面板
3. 若返回 `apply` 则执行 apply
4. 若返回 `cancel` 则退出

---

## 6. 确定性结论

在当前组件代码中，状态机是**确定性的**，并且启动时还会额外检测 keybinding 级别的设计冲突：

- 每次输入先经过固定顺序判断
- 在任一 `focus` 状态内，命中第一个分支后立即 `return`
- 同一个输入在同一状态下不会触发两个动作
- `list` 状态把保留键与搜索输入键严格分流，因此不存在“左右键既移动光标又切 scope”的冲突
- 若用户自定义 keybinding 让同一状态中的两个概念动作绑定到同一物理键，组件会在 context/title 摘要中显示冲突摘要

换言之，当前状态机满足：

> 对于给定的 `(focus, data, searchEmpty/cancelArmed/canApply/hasSelection)`，转移结果唯一；
> 并且对于默认键位配置，设计层也不存在已知概念性 non-det。

---

## 7. 已修复的一致性问题

本轮修复已消除以下问题：

1. `scope` 帮助文案原先漏写 `Tab/Shift+Tab -> actions`
2. `actions` 帮助文案原先漏写 `Space -> activate`
3. `list` 中 `Shift+Tab` 原先是静默无效果，现在与 `Tab` 一致进入 `actions`
4. `picker` / `scope` 术语不一致，已统一成 `scope picker`
5. 左右边界原先静默 no-op，现在会给出 `Local already selected` / `Global already selected`
6. `left/right/shift+tab/space` 不再依赖修改 `pi` 源码注册自定义 app keybinding id，改回插件内直接按物理键匹配，兼容标准版运行环境
7. `back` 结果与命令层 reopen 死分支已删除
8. 列表 help 现在显式表达两阶段取消：`arm cancel` / `exit`
9. 列表区改为固定行数渲染，结果少时补空行，避免面板高度随结果数量抖动
10. 启动时会扫描同状态内的概念动作 keybinding 冲突并进行提示

---

## 8. 仍然成立的设计取舍

以下不是 bug，而是当前刻意保留的设计：

- `Esc/Ctrl+C` 在最外层优先，不会落到搜索框自身的 `onEscape`
- `Enter` 在 `list` 中表示“进入 scope 编辑态”，不是提交搜索
- `Tab` 与 `Shift+Tab` 在该面板中被定义为“模式切换键”，不是输入框字符编辑行为
- `actions` 中左右切换是循环的
- `list` / `scope` 中上下移动是循环的
- `actions` 里的 `List` 按钮只是返回 `list` 焦点，不会把组件销毁重建
