# Judge

事实复核：

- Pi `requestRender`动态调用`this.doRender`，且force先把native baseline清空。
- Pi overlay/cursor/reset顺序与F7一致。
- InteractiveMode Ctrl+O最终改变`toolOutputExpanded`并requestRender；插件可通过既有getter检测。
- `ProcessTerminal.write`不提供flush acknowledgement。
- 当前README确实仍描述component-only现行实现。

裁决：

## 必须直接修

1. 增加entry baseline：entering阶段先由原生owner完成一次render，随后从native visible viewport/cursor初始化managed previous frame；同一帧不得plugin write。
2. 明确expand getter变化、width变化、force-native reason触发native full transition；该帧不得managed history write。
3. 固定frame pipeline顺序与Pi一致。
4. 把built-in tail status与unknown extension custom的finality边界写清；unknown mutation触发recovery。
5. README区分viewport-1当前代码与viewport-2未来设计。
6. 所有exactly-once表述限定正常write返回且进程存活路径。

## 阻断实现、需用户裁决

- Kitty image：首版fallback或首版完整支持。
- width resize：native recovery或Codex式reflow。设计推荐前者。
- hard-death partial write：接受正常路径保证，或停止direct history insertion架构。

## 无效问题

无。F6不是架构错误，但确为必须显式的支持退化。

SCCO：S partial（待修）；Complete partial（image/decisions）；Concise done；Optimization done。
