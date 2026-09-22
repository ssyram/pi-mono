# Task Overview and Q

**问题对象**：OMP custom compaction 在摘要末尾机械追加的 `<read-files>` / `<modified-files>` 路径清单。

**背景与现状**：长 session 的原始逐路径清单浪费上下文；旧的相邻同父目录分组不能合并任意深度、非相邻的共享前缀，并曾因根文件触发整节回退。

**本次范围**：只改变本轮工具调用生成的新路径清单 `F'` 的表示；不迁移上一轮摘要，不设计 brace 文本解析器，不改变正文、引用、provider 或分类语义。

**预期产物**：一个保守的原始路径数组 formatter、最小接线、证明和离线验证。

## Q.I — 已确认的规范方向

### Q.I.1 — 缩短新机械清单

**采纳状态**：confirmed

仅当表示严格更短时，允许把本轮新清单中的共享路径前缀改写为 brace 表示。不同根保留为不同输出行。

### Q.I.2 — 不影响 compaction 主流程

**采纳状态**：confirmed

该优化不得新增 LLM 调用、文件系统扫描、跨轮集合维护、旧摘要迁移、provider/auth/UI 行为或新的 compaction 拒绝条件。普通内部输入不能因无法识别的字符导致 formatter 抛错。

### Q.I.3 — 保守输入边界

**采纳状态**：confirmed

formatter 只负责调用者提供的原始路径数组。不能安全进入树的数组元素原样保留；已有 `a/{b,c}` 不要求解析或与 `a/d` 再合并。用户确认该保守能力足够。

### Q.I.4 — 保留现有语义

**采纳状态**：confirmed

read 与 modified 仍分别计算、分别输出；已修改路径仍不重复列入 read-only。安全路径的多重集合与重复次数必须保留，输入数组不得修改。

## Q.A — 已核实前提

### Q.A.1 — 输入不是待切行的文本块

**事实状态**：verified

`formatCompactionFileOperations()` 从内部 Set 生成已排序的 `string[]`，再分别调用 formatter。formatter 不接收 `<read-files>` 文本块，也不执行 `split("\n")`；数组元素本身就是合并单位。

### Q.A.2 — brace 文本无法无歧义证明来源

**事实状态**：verified

原始合法文件名可以包含 brace 或逗号，因此 `a/{b,c}` 既可能是旧 formatter 的结果，也可能是原始路径文本。当前设计不引入来源元数据或 brace grammar。

### Q.A.3 — 旧摘要沿原路径处理

**事实状态**：verified

上一轮完整摘要仍交给既有 reference renderer；本功能不拆出旧 `F` 再压缩，也不计算 `F ∪ F'`。最终只在非空正文后机械追加本轮新 suffix 一次。

## Q.E — 采用的经验

### Q.E.1 — 局部相邻分组不足

**事实状态**：verified

live 结果暴露旧算法只能处理相邻直接父目录，且一条根文件曾使整节无法缩短。该经验支持直接按路径段建立完整前缀树，并让 opaque 元素只局部旁路。

### Q.E.2 — 历史路径不是当前文件系统快照

**事实状态**：verified

摘要中的文件清单记录历史工具调用；文件后续删除不会回溯更新旧摘要。验收 formatter 时必须检查新 `F'` 或离线调用，不能用历史路径是否仍存在判断运行版本。

## Trace

- Q.I/Q.A/Q.E 由 [design.md](design.md) 的 D.root 回答或使用。
- 实现映射见 [code-plan.md](code-plan.md)。
- 正确性与证据见 [correctness.md](correctness.md) 和 [verification.md](verification.md)。
