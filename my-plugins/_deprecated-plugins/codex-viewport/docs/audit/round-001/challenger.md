# Round 001 Challenger

1. **ActiveRenderPolicy 不足以直接编码**：设计要求 width/height/force/history-before-viewport 都做 visible repaint，但没有定义 frame preparation、cursor 定位、baseline 更新和 terminal write 的具体接口。实现者仍需临场发明 renderer，违反 detailed design 的可直接编码要求。
2. **事件 handler 的 fail-open 范围不完整**：文档只给 patched render 的 FailOpenGuard；`session_start` probe、`agent_start` install、`agent_end` restore、`session_shutdown` dispose 若抛错，会经过 awaited extension runner，可能改变 reload/shutdown/agent event 行为。
3. **fail-open 与动态无历史重画存在表面冲突**：失败后调用原 renderer 可能立即 full redraw。文档没有声明冲突时 AI 隔离/恢复原生优先于防闪烁。
4. **active reload handoff 表述不一致**：principles 只要求任何进入静态过程完整；architecture 正确指出 core 禁止 active reload，但 research/旧讨论曾提出 handoff。当前设计应明确：supported path 无 active reload；forced path fail-open，不承诺继续 managed。
5. **static restore 的 renderer baseline 未论证**：恢复完整组件和原 methods 后，`previousLines` 仍来自 clipped active frame。需要说明 final native request 如何收敛，及为什么不会留下插件状态。
6. **第三方 patch 检测需可判定**：只写“检测已有 patch”不足。应定义 instance-own method 与本插件 marker 的判定和拒绝后的零修改后置条件。
7. **外部 editor/suspend 路径不足**：这些操作会 stop/resume TUI 并强制 render。文档列出但没有具体说明 active patch 的 terminal baseline 何时失效、如何 visible repaint 或 fail-open。
8. **image/overlay 失败时可能已部分写 terminal**：detailed design 要求 fail-open 前未写当前失败帧，但没有通过“先构造完整 buffer、后单次 write”保证这个前置。
9. **AI 零影响测试不完整**：只说 handler 返回 undefined 和 session 无写；还需验证 handler 抛错被隔离、message/tool event object 未变化、abort signal 不被触碰、没有 extension-owned handles。
10. **原则文档层级已正确收敛**：未发现事件名/API/状态机等实现泄漏；该项无 finding。
