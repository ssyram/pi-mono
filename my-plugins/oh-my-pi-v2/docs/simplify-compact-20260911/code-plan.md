# 实现映射

权威 Q/D 分别位于 [principles.md](principles.md) 和 [design.md](design.md)。本文件只记录实现，不生成新的设计规则。

## D.format

- `hooks/format-compaction-path-list.ts`（65 行）
  - `pathSegments(path)`：安全域判断和 `/` 分段；brace、逗号、Unicode、空白、dot 段等返回 opaque。
  - `formatCompactionPathList(paths)`：baseline、Map 前缀树、终点计数、逆序迭代渲染、整体长度门和 catch 回退。
- `test/format-compaction-path-list.test.ts`（124 行）：深层/非相邻共享前缀、根文件、绝对/相对根、重复、终点兼父节点、opaque、已分组输入、12,000 层和异常回退。

## D.collect 接线

- `hooks/compaction-file-operations.ts`：保持分类、Set 去重、排序和标签；readOnly 与 modifiedFiles 分别调用 formatter。
- [candidate.patch](candidate.patch)：该文件唯一运行 diff，`+4/-2`。

## D.finalize 不变

- `hooks/prepare-compaction-request.ts` 相对原基线无本功能 diff；renderer 使用原 `state`，最终只追加本轮新 suffix 一次。
- `test/prepare-compaction-request-finalization.test.ts`：确认 ON/OFF 新清单压缩、旧 suffix 原样进入 prompt、新 suffix 一次追加。

旧 suffix formatter 及对应测试已删除。`custom-compaction.ts`、正文提示词、reference codec、provider/auth/UI 均未修改。
