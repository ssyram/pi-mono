# Round 001 Counter

1. 成立。现有细化无法仅凭文档实现 active viewport renderer。
2. 成立。extension handlers 被 awaited，生命周期操作也必须 no-throw。
3. 部分成立。`principles.md` 已要求插件错误退回原 TUI并保护 AI，因此冲突有上游答案；architecture 仍需明示优先级，避免实现者错误选择“保显示目标而抛错”。
4. 成立。Pi `handleReloadCommand()` 明确在 `session.isStreaming` 或 compacting 时拒绝 reload；forced programmatic reload 只能 fail-open，不应设计猜测式 handoff。
5. 成立。core `agent_end` 会请求 render，但 deferred geometry/force 需要显式 native alignment 请求；需定义恢复 method 后再调原 `requestRender(true)`，且只在 deferred 时执行。
6. 成立。可用 `Object.hasOwn(tui, method)` + plugin marker 判定；拒绝安装前不得写 method/tree。
7. 成立。suspend/external editor 使 baseline 无效，应标 deferred、恢复后 visible repaint；不安全则 fail-open。
8. 成立。active renderer 必须纯构造 frame/buffer，所有检查通过后单次 terminal write；禁止边算边写。
9. 成立。测试需覆盖 no-throw event boundary、event deep equality、abort signal identity/state、零 timers/handles。
10. challenger 已证明 principles 只含意图/认知；无须修。
