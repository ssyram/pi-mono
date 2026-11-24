# viewport-2-active-renderer Implementation Audit

## 状态

Demand-driven ownership与resize re-entry已实现；automatic + global Pi tmux evidence通过；direct terminal matrix pending。

## 被真实使用否决的旧假设

旧实现把managed area固定为`[min(naturalTop,2),terminalBottom)`。即使没有`2J`，首帧仍会用逐行`EL2`清除几乎整个屏幕；terminal-height protected capacity又使普通run很少在运行中提交history。逻辑finality被错误地绑定到physical displacement。

该模型已替换为variable `[top,bottom)`：

- top是最早unfinished component；
- bottom是当前native内容末端；
- overflow先向下使用空行，到底后才向上增长；
- finalized rows原地保持可见；
- 只有实际容量压力才把稳定行推入history。

## Resize裁决

旧实现将width/height统一永久fallback。当前实现：

- Height/footer/widget变化留在managed epoch；
- Width调用一次Pi native `fullRender(true)`；
- 立即zero-write gate与第二次DSR；
- 保留ledger identity/finality，重建physical provenance；
- 激活新managed epoch；
- recapture失败时保留已有效native frame，不再二次full redraw。

Pi native width path使用`2J + 3J`清空并按完整component tree重建，因此re-entry要求所有managed transcript source仍在Pi tree中唯一存在。

## 其他实现期发现

- DSR必须处理split response、邻接输入、timeout后的late response和cancel replay。
- Persistent hidden overlay不能用`overlayStack.length`判断；复用Pi `hasOverlay()`。
- `TUI.stop()`在managed frame上必须先同步native recovery；width redraw后的recapture gate已是native frame，可直接restore methods。
- Write成功前ledger/protected/stable/frame均不能accept；partial write不重发prepared batch。

## Automated evidence

- 59 tests / 12 suites，0 failure。
- Stable-prefix no-clear、variable-bottom growth、one-row upward demand、finalized in-place retention、in-run history、static suffix no-repaint。
- Height managed rebase与width one-redraw/re-entry/cancel。
- Ledger、DSR、widget stale、history VT、cursor、fallback、stop/shutdown和handoff。
- TypeScript plugin config通过。
- Source/test均≤200非空非注释行。

## Global Pi evidence

Demand-driven 100x30：

```text
DSR 1
sync 260 (timing-dependent)
2J/3J 0/0
history regions 9
warnings 0
mid-run submitted message + Editor visible
final line 79 visible
```

Width 100→80：

```text
DSR 2
2J/3J 1/1
managed sync after re-entry 255
warnings 0
submitted message + final line 79 visible
```

## SCCO

- Sound：conditional pass under Pi 0.83 ABI + standard ANSI + no direct stdout writer。
- Complete：implementation contract pass；cross-terminal/IME/hard-SIGKILL matrix partial。
- Concise：pass；旧fixed-full-height policy已删除。
- Optimization：pass；无需求不扩张，width只允许一次native reflow。

## Remaining risks

- Apple Terminal直接中文IME未验证，不能宣称系统SIGSEGV修复。
- iTerm2/Kitty/WezTerm/Zellij未验证。
- Hard SIGKILL/reopen session未做真实matrix。
- Direct stdout不支持。
- Width reflow按Pi原生语义清空并重建scrollback。
