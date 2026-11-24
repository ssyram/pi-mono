# Prover

## 意图覆盖

- 动态尾部：TranscriptLedger + FrameLayout。
- source-order单份历史：frontier Hoare proof + commit-after-write。
- Editor优先：trailing-first capacity lemma。
- 输入/IME：原生input不变，cursor op最后。
- idle原生：NativeHandoff + method restore。
- AI隔离：observer-only side-effect contract。
- 非全面接管：不重写components、Editor、tool/session。

## 关键可核事实

- Pi `requestRender()`最终动态调用`this.doRender()`，instance patch可生效。
- Pi原生`doRender`使用synchronized output，并维护8项baseline状态。
- Editor以`CURSOR_MARKER`暴露IME hardware cursor位置。
- Pi root明确把chat放在index 2，trailing containers位于其后。
- `showStatus`确实可能原地更新最后Spacer/Text。
- Codex当前将pending history flush与active draw放在同一synchronized update，并使用scroll region和cursor restore。

## Hoare链

`LedgerInv`由初始化建立，reconcile/finalize/prepare/cancel保持，成功commit推进frontier仍保持。

`Layout lemma`证明active frame bounded；`History lemma`在ANSI假设下隔离history；`Cursor lemma`证明最终cursor。三者与单owner组合成成功frame postcondition。

Handoff以byte-visible equality作为门，而非直接假设component tree等价，避免旧renderer方案的baseline猜测。

## 隐含前提清单

- Pi private ABI语义与0.83.0一致。
- terminal支持所选scroll-region语义。
- doRender内component tree同步稳定。
- known finality event在final visual mutation后生效。
- stdout正常路径按调用顺序交付。
- handoff前有core final requestRender。

## Optimization证明

方案没有重做input/session/component renderer。相比全面TUI接管少一整层业务UI；相比component-only新增的history/active/cursor/handoff均由真实反例证明不可删。

## Prover结论

主架构可成立，但只在entering anchor、Ctrl+O trigger、image策略和resize recovery被补成可执行契约后达到implementation-ready。
