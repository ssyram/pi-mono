# 历史审查处置

`audit/` 原样保存了两个已被替换的方案：相邻同父目录分组，以及旧 suffix 显示副本 formatter。它们用于追溯失败和边界，不定义当前设计。

## 当前裁决

- 权威 Q：[principles.md](principles.md)。
- 权威 D：[design.md](design.md)。
- 当前实现只在本轮新清单生成点接入前缀树；旧 suffix formatter 已删除。
- 输入是原始路径数组，不是按行解析的 suffix 文本。
- brace/comma 等元素 opaque；`a/{b,c}` 与 `a/d` 不合并。用户确认该保守限制足够。

## 历史 finding 的最终归属

- **相邻分组不完整**：由完整 Map 前缀树替代。
- **根文件使整节回退**：根文件现在是正常叶子；opaque 只局部旁路。
- **旧 suffix 来源无法认证**：不再格式化旧 suffix，因此该风险移出当前设计。
- **表示歧义**：保留为明确边界；不构造 brace parser 或伪造唯一解码。
- **baseline 外异常**：普通内部数组是前提；baseline join、恶意 Proxy、OOM/VM 终止仍在保证外。
- **本轮表示会持久化**：这是已确认目标；新 `F'` 以压缩形式随新摘要保存。

## 当前证据

61/61 相关离线测试、formatter strict tsc、快速 Hoare OK 和全 UTF-16 code unit 定向检查。完整记录见 [verification.md](verification.md)。全仓检查仍被无关模型目录类型错误阻塞。
