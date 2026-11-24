# 细化：NativeHandoff

Seamless predicate以native cursor和managed physical cursor求隐式`logicalOriginRow`。`logicalOriginRow>0`表示Pi short session从terminal中部开始；它不是`previousViewportTop`，Pi原生也通过logical relative delta隐式携带它。`logicalOriginRow<0`表示retained viewport可超过logical tail，并允许Footer后的真实bottom slack。

未被Pi占有的terminal顶部prefix不要求伪造attestation；predicate要求native logical rows不能落入该prefix，并逐行比较其后的stable suffix、managed frame和terminal-bottom blanks。Cursor column、image absence、displacement provenance和geometry也必须一致。

Prepared prefix 的 native observation 在 managed terminal write **之前**完成。若该 observation 与同一transaction的next frame不等（例如 task/status 恰在两次component observation之间更新），renderer取消 prepared token、保留managed owner并等待下一帧；不得把这个正常动态竞争降级成native fallback。只有prewrite predicate全真且write返回后，才更新Pi private baseline；不request render、不调用saved native `doRender`。`maxLinesRendered`采纳当前已清理physical working area，防止下一native diff因旧high-water触发`2J/3J`历史重输出。draining handoff仍在mismatch时native recovery。

低层`agent_end`不交权；官方`agent_settled`设置drain。下一patched frame看到最终component tree后比较。Active managed上的TUI stop同步recovery；width recapture gate已经是native frame，只恢复methods后stop。
