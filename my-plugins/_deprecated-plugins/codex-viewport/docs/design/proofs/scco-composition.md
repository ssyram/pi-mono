# SCCO 分层复合

状态：**local code contract PROVEN；production-wide NOT PROVEN。** 旧证明依赖已删除的`ProtectedHistoryRows`、手工history insertion和upward viewport expansion，永久失效。当前证明以Round 006 adjudication为准。

证据：

- `../../audit/viewport-2-active-renderer/round-005/`
- `../../audit/viewport-2-active-renderer/round-006/adjudication.md`
- `../../correctness-audit.md`

## Sound

- ledger只选择最大连续finalized source-order prefix；
- 同一managed transaction的prepare/paint共用一次component observation；
- Editor/Footer优先，synthetic slack只在Footer后；
- ordinary managed diff使用absolute CUP + EL2，不发CRLF history insertion；
- memory frame/frontier只在terminal write返回后accept；
- native commit采用已可见frame作为Pi baseline，不二次render；
- handoff覆盖nonzero physical origin、retained viewport、bottom slack、cursor和unknown pre-Pi prefix；
- `agent_settled`、generation/patch/abort identity关闭lifecycle；
- snapshot capture到artifact publication均受stop/abort transaction fencing。

## Complete（local contract）

Entry、managed render、ledger prepare/accept/cancel、native adoption/re-entry、height/width、overlay/image/write failure、drain/stop/shutdown、snapshot lease/publication/cap与stale async completion均有deterministic regression。

## Concise

插件不替换Pi messages、tools、Editor、input、provider、session或persistence。新增责任限于run-scoped renderer ownership、physical frame provenance、baseline adoption、DSR和snapshot artifact。

## Optimization

- 保留pending crop，拒绝重新引入stable-row displacement；
- opaque/custom component无正向证据时保持pending；
- transition失败后本run保持native，不盲重试unknown partial prefix；
- baseline adoption替代第二次native render，消除commit flash和重复component observation。

## 当前证据

```text
87 automated tests / 16 suites
56 non-test TS files / 19 test files
TypeScript plugin config passed
all TS files <= 200 nonblank noncomment lines
Round 006 local tribunal: PASS
```

## Production residual

Accepted terminal control grammar、Apple Terminal中文IME、其他terminal/multiplexer、早注册foreign input listener、direct stdout、partial physical write、SIGKILL/reopen和filesystem/platform durability仍未完成跨环境证明。因此不得把本文件解释为production-wide安全保证。
