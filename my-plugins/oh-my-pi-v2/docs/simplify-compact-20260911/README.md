# Compaction 新文件清单前缀树压缩

## Task Overview

本专项只缩短本轮工具调用机械生成的 `<read-files>` / `<modified-files>` 内容：

```text
上一轮完整摘要 B' + 本轮对话 → AI → S
本轮工具调用 → 原始路径数组 F' → conservativeTrie(F')
最终返回 S + conservativeTrie(F')
```

输入是路径数组，不是待按行解析的文本块。安全路径按 `/` 建完整前缀树；opaque 数组元素原样保留。已有 `a/{b,c}` 不解析，因此不会与 `a/d` 合成 `a/{b,c,d}`。用户已确认该保守边界足够。

## 当前设计状态

- 只格式化本轮新 `F'`；不重压旧 suffix，不做 `F ∪ F'`。
- read-only 与 modified 分别建树，不跨标签合并。
- 任意深度、非相邻的安全路径共享前缀可合并。
- 根文件正常保留；未知字符只使该元素 opaque，不使整表失败。
- 仅在整体字符串严格更短时采用；baseline 后的可捕获异常返回原串。
- 相关离线套件 61/61 通过；全 UTF-16 code unit 定向检查未发现字符触发异常。

## QPDI 文档

- [principles.md](principles.md)：Task Overview 与已确认 Q.I/Q.A/Q.E。
- [design.md](design.md)：D.root、D.format 的 P/M/R 与保守边界。
- [code-plan.md](code-plan.md)：D 到实现文件的映射。
- [correctness.md](correctness.md)：WP/SP 与组合正确性。
- [verification.md](verification.md)：测试证据和未覆盖边界。
- [hoare-review-result.md](hoare-review-result.md)：快速独立论证记录。
- [audit-resolution.md](audit-resolution.md)：历史方案与当前裁决的对应关系。
- [candidate.patch](candidate.patch)：唯一运行接线 `+4/-2`。

`audit/` 保留旧相邻分组和已删除旧 suffix 方案的原始审查记录；它们是历史证据，不定义当前设计。
