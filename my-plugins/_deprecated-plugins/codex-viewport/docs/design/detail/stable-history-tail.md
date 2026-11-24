# 细化：StableScreenRows

`StableScreenRows`保存managed area上方当前可见的attested bytes。它只服务native handoff的物理连续性验证：native logical visible tail必须等于`StableScreenRows + InlineViewportFrame + terminal-bottom blanks`。

它不拥有history，不接收component render rows，也不决定内容何时离开live。一个source-order finalized prefix由Pi native commit完整提交；如果handoff证明或re-entry失败，插件恢复Pi native ownership，不伪造stable provenance。

`ProtectedHistoryRows`已删除。完整block语义和回归见 `../fixes/atomic-block-native-commit.md`。
