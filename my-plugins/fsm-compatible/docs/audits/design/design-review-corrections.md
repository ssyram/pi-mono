# 首单元限定修正确认

## 结论

**`fsm-1-admission-binding`：READY，可以立即进入该单元编码及直接测试。**

原 B1/B2 已闭合；未发现此次修正直接引入同合同回归。本报告仅确认这两项修正，不构成完整系统放行。

## B1：原 mandatory 恢复基线——已闭合

- `docs/design/fsm-compatibility/architecture.md:102` 明确根、子 binding 保存上次成功接线的非秘密 mandatory 真路径快照。
- `docs/design/fsm-compatibility/detailed-design.md:65` 指定事实来源为当前真实分支的持久 binding，不再从当前配置反推原值。
- `:101、105` 分别规定根、新子绑定复制已验证 policy 的 id/path 快照。
- `:113` 明确逐项比较 `saved.requiredExtensions` 与当前 policy；删除或同 ID 换路径返回 `restore-conflict`。
- `subplans/fsm-1-admission-binding.schema.json:27-38、69-76` 要求非空快照、包含 `fsm-compatible`，并将该字段设为持久绑定必需项。

原反例现已被覆盖：saved 含 `{self, X}`、当前仅 `{self}` 时拒绝；缺失快照属于坏绑定，不退化为未绑定后新建。

新增 mandatory 的处理也保持原合同：恢复函数只返回候选新快照；**实际接线成功后**调用者才追加 binding，推进后续基线。依据为 `detailed-design.md:119`、叶子合同 `subplans/fsm-1-admission-binding.md:63、75`、`docs/audits/fsm-1-admission-binding/expectations.md:66、80`。

## B2：root/child 恢复分支——已闭合

`docs/design/fsm-compatibility/detailed-design.md:113-119` 已明确：

- 共同检查实际 self、owner root 和原 mandatory。
- root 检查 `root=self`、`agentId=main`、parent/agentName/bootstrapRef 为 null；**不查询 child 名单或 parent 存在性**。
- child 检查原 canonical agent、`agentId=self≠root`、同 root 真实父链、无环及 depth。
- 两路成功保留原身份字段；失败不 fallback 为 new，不修改 saved 或消费 dispatch。

叶子合同 `subplans/fsm-1-admission-binding.md:63、75` 和 expectations `:67、79` 已同步。因此合法 root 不再因空 parent 或不在 child allowlist 中而误拒绝。

## 直接回归确认与边界

**No issues found.**

此次修正没有改变固定名单、后代不可扩大准入、一次 launch 最多绑定一个 self、身份保持及首单元零外部运行效果的合同。新增快照不包含秘密；候选快照返回与实际加载、持久化成功仍明确分离。

用户提供的 Ajv 严格编译及 12 个 shape 用例结果，本次未复跑，也未用作语义正确性证明；上述确认来自修订合同、schema 和具体恢复分支的对照。

**B3–B9 保留为后续单元责任，本次未重查。** READY 仅允许首单元编码，不代表插件已运行或完整 FSM 兼容已验收。未修改文件、启动子代理或调用 provider/daemon。