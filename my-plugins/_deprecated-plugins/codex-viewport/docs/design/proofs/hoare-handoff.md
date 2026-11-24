# Hoare Proof：Native Handoff

令H为terminal height，N为Pi full normalized lines，V为其visible tail，M为attested stable rows与managed frame的physical composition。D为本epoch真实overflow造成的upward displacement，R为新增finalized rows。

Predicate：stable bytes known、`|N|≥H`、`D=0 or R≥D+H`、`V=M`、cursor/geometry/image policy相同。

全真时把Pi private baseline设为N及其viewport/cursor/image状态，再恢复original methods。Postcondition是native baseline准确描述physical screen；tree不变时下一native diff无history write。

任一条件失败不修改baseline并执行native recovery，因此不伪造single-copy状态。Variable-bottom short frame可能拒绝seamless。Width recapture失败保留mandatory full reflow建立的native baseline；若gate消费了后续更新，还需native catch-up render，且Pi自身full-render条件仍然生效。

Stop在active managed上同步recovery后调用original stop；hard death没有handoff，只由session JSONL恢复已持久化内容。
