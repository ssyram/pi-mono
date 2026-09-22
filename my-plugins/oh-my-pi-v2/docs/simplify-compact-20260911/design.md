# QPDI Design：本轮新路径清单的保守前缀树

本设计回答 [principles.md](principles.md) 中已确认的 Q。代码与命令只在 [code-plan.md](code-plan.md) 中映射，不在这里充当设计理由。

## D.root — 新清单表示优化

### Upstream

- Q.I.1：仅采用严格更短的新清单表示。
- Q.I.2：不扩大 compaction 主流程和失败面。
- Q.I.3：只处理原始路径数组，brace/未知文本可 opaque。
- Q.I.4：保持分类和路径内容语义。

### P

- **P.local.input**：输入是调用者已建立的 `readonly string[]`；数组元素是路径单位，不按换行再次切分。
- **P.local.scope**：只格式化本轮 `F'`；旧摘要、正文和引用 state 不变。
- **P.local.separation**：read-only 与 modified 分别格式化，不跨标签合并。
- **P.local.preservation**：输入不变；安全路径多重集合与重复次数保持；opaque 元素原文保持。
- **P.local.non-growth**：仅当整体候选字符串严格更短时采用。
- **P.local.containment**：baseline 建立后的可捕获异常返回 baseline；未知字符本身不得导致抛错。

### M — Operational Model

- `D.collect`：沿用既有工具调用提取、Set 去重、`modified = written ∪ edited` 和 `readOnly = read − modified`。
- `D.format`：对每个分类的原始路径数组独立构造保守前缀树；详见下节。
- `D.finalize`：沿用既有正文引用展开、空正文判断和一次 suffix 追加。

**composition**：`D.collect` 产生两个互斥的已排序数组；`D.format` 各自返回不长于原串的表示；标签包装后形成本轮 `F'`；`D.finalize` 返回 `S + formatted(F')`。上一轮摘要只作为既有模型输入，不进入 formatter。

### R — Reasoning

**Derivation**：上下文浪费来自新机械清单；因此表示优化应放在新清单的权威生成点，而不是扩张成旧摘要迁移或跨轮维护。

**Satisfaction**：分类组件保持原语义；formatter 的路径保留与长度门满足内容和非增长要求；finalizer 不变满足单次追加和主流程隔离。三者组合不新增 I/O、provider、状态或拒绝条件。

**Optimality**：与“解析已有 brace 再归一化”相比，opaque 旁路不需要区分原始文件名与历史格式，也不引入 grammar、来源元数据或额外失败分支。它不能把 `a/{b,c}` 与 `a/d` 合并，但用户已确认这一保守限制足够。

## D.format — 原始路径数组 formatter

### P

- 安全路径段非空、不是 `.`/`..`，字符只属于 `[A-Za-z0-9._@%+=~-]`；最多允许一个开头 `/`。
- 不符合安全域的整个数组元素为 opaque：原样输出，不加入树，也不阻止其他元素压缩。
- 绝对与相对根隔离；不同根输出不同项。
- 节点可同时是终点和父节点；重复终点按次数保留。
- 遍历不得依赖递归调用栈。

### M

1. 先建立 `baseline = paths.join("\n")`；少于两项直接返回。
2. 对每个数组元素做安全域判断。安全元素按 `/` 切段并插入 `Map` 前缀树；opaque 元素直接进入输出序列。
3. 节点按父先子后创建，随后逆序迭代渲染：单孩子用 `/`，多孩子用 `{…,…}`。
4. 将树根形式与 opaque 原文组合；候选严格更短才返回，否则返回 baseline。
5. baseline 之后的可捕获异常返回 baseline。

例：

```text
输入数组：a/b/c, x/z, a/b/d, a/e
候选：    a/{b/{c,d},e}\nx/z
```

反例边界：

```text
输入数组：a/{b,c}, a/d
输出：    a/{b,c}\na/d
```

第一项含 brace/comma，属于 opaque，不会被解析为树。

### R

**Derivation**：完整前缀树直接满足任意深度和非相邻共享前缀；安全域把表示语法与原文风险隔离。

**Satisfaction**：插入时每个安全前缀唯一对应节点；终点计数保存重复。父先子后的创建顺序允许逆序渲染而不递归。opaque 从未被改写。最终长度门同时覆盖混合列表的整体收益。

**Optimality**：`Map` 树是满足深层共享前缀的最直接结构；局部相邻扫描不完整，brace parser 又超出已确认边界。

**implemented-by**：`hooks/format-compaction-path-list.ts` 的 `pathSegments()` 与 `formatCompactionPathList()`。

## 明确边界

- `a/{b,c}` 不是 formatter 的可解析中间表示。
- opaque 元素中的换行可能保持原有视觉歧义；本功能不提供解码协议。
- baseline join、静态模块加载、不可恢复 OOM/VM 终止不在 catch 保证内。
- 字符长度不增长不推出 token、延迟或模型理解一定改善。
