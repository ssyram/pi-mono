# Counter

逐条反驳challenger，不能被事实驳回的保留。

- F1：有效。现文档没有entry baseline构造，不能从“已patch”推出physical frame已知。
- F2：有效。`getToolsExpanded()`提供可检测信号，但设计尚未把“检测变化→本帧不managed write→native force redraw”写入契约。
- F3：有效。known-state已标pending，故不是隐瞒；但implementation-ready只能是conditional。
- F4：部分有效。正常Node stdout保持调用顺序是合理运行假设，但write返回不等于physical flush。必须把postcondition限定为正常交付模型，hard failure留在风险域。
- F5：有效。仅写“无法证明则recovery”不够，Runtime必须以width change强制触发该分支。
- F6：有效影响、非Sound错误。保守opaque满足正确性，但可能退化为整run不commit；必须warning/metrics并作为支持边界。
- F7：有效。Pi源码顺序是render→overlay→cursor extraction→line reset；新设计必须逐字固定同序。
- F8：有效。不能仅凭generic Text断言status。可采用官方tail-displacement契约；任意第三方动态custom不提供强保证，mutation后只能recovery。
- F9：有效边界，现known-state已承认；任何最终guarantee必须限定正常write路径。
- F10：有效。README描述当前viewport-1代码，需增加viewport-2尚未实现提示，不能改写现行行为为未来行为。

反驳结论：F1/F2/F5/F7/F8/F10为直接可修文档缺口；F3为用户决策；F4/F6/F9为边界措辞与验证义务。
