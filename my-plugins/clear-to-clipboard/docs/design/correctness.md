# clear-to-clipboard：函数推导与文档间 SCCO

状态：**新方案的设计层条件推导 + 定向执行证据，不是系统剪贴板最终写入证明**。用户更新了目标：插件负责在 pi 清空前向系统**发起**复制请求，长粘贴请求文本用 `[paste#ID## <actual text> ##]`；系统是否采纳不在合同内。本文件依据 [architecture.md](architecture.md) 的 root P 和 [detailed-design.md](detailed-design.md) 的函数步骤推理。先前独立只读推理 run `85f28409-7853-4ecf-8e88-911964e1f86c` 发现旧自定义 editor/await 方案的反例；新方案经用户裁决后改用真实 action handler 包装，**不把旧报告说成对新方案的独立通过证明**。

## 1. 规约与 pi 源码事实

- **目标**：当 TUI 主 editor 实际执行 `app.clear` 且文本非空时，先以当前文本构造一次剪贴板写入请求，再交给 pi 原 handler；粘贴标记 `[paste #N …]` 对应实际正文时请求文本含 `[paste#N## ${正文} ##]`；不改官方源码。
- **运行事实**：`CustomEditor.handleInput` 调到 `actionHandlers` 中的真实 app action handler；TUI 的 input listener 在焦点组件 `handleInput` 之前调用；`setExtensionWidget` 同步运行组件 factory，factory 能拿到 TUI；当前 renderer 运行时有 `getFocusedComponent`（不在导出的 `TUI` 类型接口中，插件运行时检测）；`Editor.handlePaste` 保存编号 `N` 与正文于运行时 `pastes` Map，并插入 `[paste #N …]`；`copyToClipboard` 返回 Promise，拒绝不应抛成未处理错误。源码位置：`packages/coding-agent/src/modes/interactive/components/custom-editor.ts`、`interactive-mode.ts` 的 `setExtensionWidget`/`handleCtrlC`、`packages/tui/src/tui.ts` 的 `handleTerminalInput`/`getFocusedComponent`、`packages/tui/src/components/editor.ts` 的 `handlePaste`。
- **明确边界**：`pastes` 不是公开扩展 API，当前 pi 版本的运行时字段与 marker 格式是本插件精确 ID/正文承诺的前提。操作系统剪贴板的最终内容不是插件可控制状态。

## 2. HoarePrompt：自然最强后置状态（NSP）

令状态 `S=(F,A,H,W,B)`：`F` 为当前焦点组件，`A` 为其 `actionHandlers["app.clear"]`，`H` 为每会话保存的原 handler→包装关系，`W` 为 raw 中有效 paste marker 对应的正文映射，`B` 为外部系统剪贴板状态（未知）。以下“发起”指确实调用 `copyToClipboard(payload)`；它只承诺一次 API 请求，不承诺 B 的后置值。

### 2.1 `attachClearAction()` 与 `installWrapper()`

- 前置：TUI 会话开始，UI 的 widget factory 同步执行。调用 `setWidget(key,()=>zeroLineComponent)` 后得到本 session TUI，再 `setWidget(key,undefined)`；**NSP**：无持久 widget，多一个对 TUI 的会话私有引用。注册 input listener；**NSP**：其回调在焦点组件处理按键前运行，自己不 consume、不改 data。
- 输入到来，若焦点组件没有合适 Map/getText/getExpandedText 或没有 `app.clear` 函数 handler：**NSP**：无包装，pi 仍按原路径处理该输入。
- 若当前 handler 已是本会话在该 editor 上装的 wrapper：**NSP**：保持原 Map，不叠加第二层。若 handler 是从另一个 editor 复制的本会话 wrapper，则从 `originalForWrapper` 找到它保存的原函数后在当前 Map 安装**一层**新 wrapper。其它有效 handler 同样保存原值并安装；**NSP**：该 editor 的 `app.clear` 现在指向 wrapper，其它 action 不变。
- shutdown 的 release：先取消监听，再对有限记录集合逐一比较 Map 当前值；仍为自己 wrapper 时恢复原 handler，不相等时保留别人后来安装的 handler；**NSP**：插件不再接收键，也不回写其他扩展的变更。每轮处理一条有限记录，终止。

### 2.2 真正的 `app.clear` 包装回调

- 前置：pi **已选择**并调用 `app.clear` Map 项，`original` 为安装时该项的 handler。若焦点不是适用主 editor：**NSP**：不请求复制，立即调用 original 一次。
- 若焦点 editor 的 `raw=getText()` 为空：**NSP**：不请求复制，original 被调用一次（pi 自行处理第一次空清空或双击退出）。
- 若 `raw` 非空、`pastes` 是当前 pi Map：先纯计算 `payload`，再发起 `copyToClipboard(payload)` 并附拒绝 handler，最后同步调用 original 一次；**NSP**：调用 original 前已用同一时刻 editor 数据构造并发起一次复制请求，原动作没有等待 API 结算。原动作可能清空或在 500ms 内退出；**不推出**系统剪贴板 `B=payload`。
- 若 `pastes` 不可用：请求 `getExpandedText()` 得到可用正文（但不声称精确 `[paste#N## ... ##]` 格式），随后 original 一次；未知版本退化是显式边界。若格式化/请求意外失败，`try/finally` 仍调用 original 一次；这条异常路径不能声称成功发起剪贴板请求。
- Promise 兑现/拒绝之后，回调不再访问 editor，也不调用 original；**NSP**：异步结果不可能让旧 editor 清空后来重建的 editor。

### 2.3 `formatClipboardPayload()`

- 前置：raw 有限长，Map 为当前 editor 的 paste Map。有限个不为空的 marker match 各自读取 ID：有字符串正文时替换成 `[paste#N## ${正文} ##]`，无正文时原文返回；普通区段保持不变。**NSP**：输出与 raw 的非 marker 部分相同，每个有映射的 marker 有与其 ID 一致的正文，Map 未变；正则全局扫描有限字符串必终止。
- 特例：手工键入与真实 marker 完全同形的字符串、且该 ID 恰存在时，当前 pi 的 `getExpandedText()` 也将全局替换它；接口未暴露“哪个出现位置才是真 marker”的区别。本设计不宣称在此病理情形下区分手打文本与粘贴标记。

## 3. 整体链路与原反例处理

`Q.I → P1/P2/P3 → 真实 handler 包装 + 当前 editor 的 raw/Map → copyToClipboard(payload) 调用 → original()`：初始时 `pastes` 与当前焦点 editor 属于同一实例，不构造新 editor，故旧方案安装/重载时丢 paste Map 的反例 R1 不再由本插件引入；原 handler 在同一个同步栈执行，Promise 不保存 editor 并异步清空，R2 不再由本插件引入。用户明确只要求写入请求，因此 OSC 52 不回执的 R3 是**合同以外**，不能用它反证 P1；包装真实 handler 而非提前猜键消除旧 R4 的快捷键冲突，且无 await 保留 pi 原双击计时。

组合论证的前提是：host 的 input listener 时序、真实 editor 暴露 `actionHandlers`、当前 pi `pastes` 私有 Map 与 marker 格式不变、其它扩展未绕过/替换本插件 wrapper。外部读/写剪贴板失败、不明窗口焦点、pi 官方版本变更不能由此推导出强保证。已用真实 pi-tui Editor 的长粘贴、真实 `CustomEditor` 的 Ctrl+C 分派及假剪贴板函数跑过定向测试（11/11）；tmux 会话已显示插件加载。未对真实系统剪贴板执行写入测试，不据此断言系统采纳了请求。

## 4. SCCO：文档关系而非代码验收

| 维度 | 设计层结论 | 理由 |
|---|---|---|
| Sound | **有前提的局部成立** | 用户明确把“成功写入”降为“向系统发请求”；P1 的 API 调用在 original 前同步触发。私有 paste Map/当前 pi 版本是精确格式的真实前提，不能写成公开 API。实现已通过定向测试，但测试不推出所有终端/未来 pi 版本的正确性。 |
| Complete | **对既定适用域覆盖** | 普通文本、多个 marker、空编辑器、无焦点、粘贴映射不存在、复制拒绝、session shutdown、已包/重新包 handler 均在详细设计中有路径；手打同形 marker 与其他扩展后写 handler 是显式边界。 |
| Concise | **满足设计目标** | 不替换 editor、不写 OS 命令矩阵、不建立等待复制的 pending 状态；只有必要的会话监听、精确动作包装和纯格式函数。 |
| Optimality/Orthogonality | **就真实候选而言更直接** | 相比预匹配 `Ctrl+C`，只在 app.clear 真触发时复制；相比换 editor，无初始化 paste 映射迁移问题；相比 await，不破坏 pi 原 500ms 时序。依赖私有 Map 是满足用户“ID+正文”而公开扩展 API 没有映射时的代价，并非稳定 API 最优性的绝对证明。 |

D.root 的可判定行为是“当前 pi、映射可读且真实 `app.clear` 被触发时，清空前发起一次含请求格式的剪贴板 API 调用”；定向测试支持这条实现路径。不把“系统收到且永久保存”塞回 Q/P，也不把测试覆盖外的运行环境写成已证明。
