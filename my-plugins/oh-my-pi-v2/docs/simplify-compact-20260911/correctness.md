# 正确性：`S + conservativeTrie(F')`

规范见 [design.md](design.md)。

## Formatter 的 P / Q

P：调用者提供内部普通 `readonly string[]`，baseline join 可完成；数组元素是路径单位。

Q：输入不变；结果不长于 baseline；安全路径多重集合和重复次数保持；opaque 元素原文保持。允许树分组改变安全路径行序。baseline 之后的可捕获异常返回 baseline。

## WP / SP

### 安全域判断

`pathSegments()` 对普通字符串只执行 `startsWith`、`slice`、`split` 和固定正则。未知字符、brace、逗号、空白、控制字符、Unicode、空段及 dot 段返回 `undefined`，调用者把原字符串加入输出；它们不进入树，也不会自行抛错。

已有 `a/{b,c}` 因 `{`, `}`, `,` 为 opaque。与 `a/d` 同时输入时，两者不会合并，这是 P 明确允许的保守边界。

### 插入循环

不变量：每个已处理安全路径前缀唯一对应一个 Map 节点；`terminals` 精确累计终点次数；父子边保持段序；根只在首次创建时进入输出序列。内层每步消费一个段，外层每步消费一个数组元素，均终止且不修改输入。

### 逆序渲染循环

节点创建顺序必为父先子后。逆序处理父节点时，所有孩子 forms 已完成；终点 forms 与子树 form 同时保留。循环每步减少一个未处理节点，不递归，因此不依赖路径深度的调用栈。

### 返回门

候选满足内容性质后，`compacted.length < baseline.length` 才返回候选；否则或 catch 返回 baseline。因此 Q 成立。

## 组合

`D.collect` 建立 `modified = edited ∪ written`、`readOnly = read − modified`，两类分别排序和格式化。`D.finalize` 对上一轮摘要使用原 state；正文展开后为空则返回空，否则返回 `S + formatted(F')`。所以不存在旧 suffix 重压、`F ∪ F'` 或跨轮智能去重。

## 证明边界

baseline join、静态加载、恶意 Proxy/非字符串运行时违约、不可恢复 OOM/VM 终止不在保证内。字符串长度不增长不证明 token 或模型语义改善。
