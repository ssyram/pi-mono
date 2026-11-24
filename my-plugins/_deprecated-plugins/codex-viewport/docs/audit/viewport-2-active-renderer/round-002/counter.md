# Round 002 Counter

对“无新缺口”构造反例：

- 若original entry render抛错，设计明确传播原生错误且managed不启动。
- 若Ctrl+O与prepared batch同帧，检测先于prepare，故batch不存在。
- 若width在plan后write前改变，JS同步doRender期间terminal resize event不能插入执行；下一event处理。
- 若opaque committed后外部修改，reconcile报告committed mutation并recovery；不能保住零重画，但不静默错误。
- 若write部分成功再抛错，poisoned路径不声称single-copy。

反例均被现有分支覆盖；不能驳倒round-002结论。图片策略仍无法由现有契约自动推出。
