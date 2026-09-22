# 快速 Hoare 结果

## 结论

独立 reasoner 对最终 `S + trie(F')` 快照给出 **OK**，未发现契约反例。

覆盖：安全路径解析、前缀树插入不变量与终止、逆序渲染不变量与终止、重复终点、绝对/相对根、opaque 隔离、严格长度门、catch 回退、read/modified 分类和一次追加。

## 运行记录

- workflow：`e9c423a0-742e-4d82-9764-7f059a0d53d3`
- child：`d8ef8bf7-27c4-42b6-92b0-3f8ca42ac6df`
- 原始输出：`/Users/ssyram/.pi/agent/sessions/--Users-ssyram-workspace-ai-tools-pi-mono--/subagent-artifacts/outputs/e9c423a0-742e-4d82-9764-7f059a0d53d3/quick-final-hoare.md`

后续用户确认了更精确的保守边界：formatter 输入是原始路径数组；已有 brace 表达式不解析。该边界与原证明的 opaque isolation 一致，不改变 OK 结论。全 UTF-16 定向运行和 61/61 文件测试由父流程直接执行。

上一轮摘要仍走原 renderer；本功能只从本轮工具调用计算 `F'`。不存在旧 suffix formatter、`F ∪ F'` 或跨轮去重。

`audit/` 中的旧报告不证明当前版本；其处置见 [audit-resolution.md](audit-resolution.md)。
