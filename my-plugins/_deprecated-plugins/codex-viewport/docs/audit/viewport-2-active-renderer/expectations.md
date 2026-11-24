# viewport-2 Implementation Expectations

- Entry只接管最早unfinished/differing component到native当前content bottom。
- Stable submitted message以上rows在无真实overflow时不得收到`EL2`或位移。
- Growth先downward，后upward；一行overflow最多增长一行。
- Finalized visible rows保持原位；blocked finalized suffix不越过pending且不重复paint相同bytes。
- Agent仍运行时，实际不可见的连续finalized rows进入top history region。
- Editor/footer优先；widget和transcript从顶部裁剪。
- Height/footer/widget变化保持managed。
- Width恰好一次native reflow，随后第二次DSR和managed re-entry；失败保留native frame。
- Visible overlay、image、Ctrl+O、force、committed mutation和write failurefail-open；hidden overlay不触发。
- AI/provider/tool/session/input语义零修改。
- Stop/shutdown、partial write和async cancellation不得留下旧epoch writer。
