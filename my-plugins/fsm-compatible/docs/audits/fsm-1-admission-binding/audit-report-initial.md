# 首单元实施后独立契约对照

## 结论

**`fsm-1-admission-binding`：BLOCK。**

已分页读完 `docs/audits/fsm-1-admission-binding/implementation.patch`。发现 **1 项未解决的核心契约差异**：child 恢复可能接受会形成父环的绑定。

本次仅对照首单元 patch，不读取完整 src、不重新审查设计、不扩展到 B3–B9。

## 独立抽取的 expectations 与实现对照

标准来自原则、架构首单元合同、叶子 A1–A6/P1–P7 和事前 expectations，不以实现自述确定。

| 原合同要求 | 判断 | diff 中的实现依据 |
|---|---|---|
| 仅明确 canonical 集合准入，空名单不派遣，不以发现列表扩张 | 符合 | `src/admission/build-admission-policy.ts:14-37` 按名单精确匹配唯一候选；`admit-child-launch.ts:51-53` 拒绝名单外 agent。 |
| native Pi；mandatory 真路径唯一、包含真实 self，最终不超过 32 项 | 符合 | `build-admission-policy.ts:19-28`；`canonicalize-required-extensions.ts:28-54`。扩展只做路径/文件检查，不执行。 |
| 后代名单/depth 不扩大，mandatory 不删换，沿用父定义快照 | 符合 | `narrow-admission-policy.ts:10-26`。 |
| caller 来自宿主，拒绝模型身份及免检字段；检查父链、depth、工具 ceiling | 基本符合；恢复父环例外见 C1 | `admit-child-launch.ts:38-65`；`parent-chain.ts:5-22`。 |
| snapshot 深复制、冻结，无公开可写 Map/Set | 符合 | `snapshot-agent-definition.ts:6-43`；policy、工具列表及 binding 输出均复制冻结。 |
| root 保存 main/null 等式；child 不占 main；两者保存原 mandatory 基线 | 符合 | `create-root-binding.ts:6-18`；`bind-new-child.ts:17-50`；`read-persisted-binding.ts:49-56`。 |
| 恢复不换 actor，不删原 baseline；root 不走 child 名单/parent 检查 | 符合，父环校验除外 | `restore-actor-binding.ts:15-32`。新增 mandatory 仅返回候选值，没有提前写持久 entry。 |
| new launch 最多一个实际 self，失败不修改登记 | 符合 | `bind-new-child.ts:17-38、52-55`：检查先于 mutation，拒绝不同 self，允许相同 self 确认。 |
| 首单元零 provider/daemon/spawn/注册效果 | 符合 | patch 全部新增源码中无这些调用；仅声明允许的路径检查和 PendingLaunch 登记。 |

## C1 — P1 / critical / unresolved

### 恢复校验未检测“接入待恢复 self 后形成的父环”

**位置：**

- `src/binding/restore-actor-binding.ts:25-26`
- `src/binding/parent-chain.ts:5-22`
- 对应 patch：`implementation.patch:623-640、742-750`

恢复只调用：

`parentDepth(callerRoot, binding.parentSessionId, records)`

该函数从 parent 开始，用空 `seen` 遍历**当前 records**；它不知道待恢复的 self 是禁止出现在祖先链中的节点。

### 静态反例

使用相同 root、合法 agent、相同 mandatory，`maxDepth=8`：

1. 当前 records 为无环树：`r(root)`，`c.parent=r`，`d.parent=c`。
2. 待恢复 saved 的 self 为 `c`，但 `saved.parent=d`；其他身份及 baseline 字段合法。
3. `readPersistedBinding` 接受该形状：parent 非空且不等于 self。
4. 恢复遍历 `d → c → r`，没有重复节点，返回 depth=2。
5. `restoreActorBinding` 返回成功的 `c.parent=d`。
6. 用该结果恢复 c 后，得到 **`c → d → c` 父环**。

这是源码分支推演，**本次未执行该反例**。问题不依赖 provider、daemon 或后续模块。

### 原合同差异

- `docs/design/fsm-compatibility/architecture.md:66`：执行父链无环。
- `docs/audits/fsm-1-admission-binding/expectations.md:79、85`：非法 parent 替换、父环应拒绝。
- 叶子合同 P7 要求恢复验证真实父链；当前实现只证明旧 parent 链自身无环，不能证明待恢复绑定接入后无环。

现有测试验证了当前 records **已经有环**时 `parentDepth` 拒绝，但未覆盖上述“旧树无环、恢复接入后成环”的情况：`implementation.patch:838-850、883-889`。

### 最小修正

恢复检查父链时，将 `actualSessionId` 作为禁止遇到的祖先节点；或用待恢复绑定覆盖同 ID 记录后检查完整链。冲突返回 `restore-conflict`，不修改 saved、不 fallback 为 new。

补上述失败反例，并保留合法 root 无 parent 查询、合法 child 恢复的既有用例。无需改架构或引入外部运行效果。

## 五维度兜底结论

- **一致性：**除 C1 外，已检查的首单元合同与实现一致。
- **风格：**patch 中无业务逻辑 index、bucket 文件、inline import、`any` 或类型抑制；源码文件均未超过 200 行。
- **正确性：**C1 未解决，阻止本单元验收。
- **性能：**集合、记录和父链操作有界；未发现有证据的额外性能问题，不新增时间阈值。
- **可维护性：**准入、快照及绑定职责分离；C1 可通过局部父链检查修正，无需重写。

## 验证与放行边界

父线程报告 **21/21 测试、64 个集合组合通过，插件 tsc 无诊断**；这些不是本次独立运行结果，也未覆盖 C1。

根检查因缺少 `@biomejs/wasm-nodejs` 在首项中止，后续检查未执行。**不能宣称全仓 check 通过**；本报告不要求越界清理根依赖，也不以该环境问题代替代码契约判断。

- **Correct：**固定集合、mandatory 单调性、root/main 隔离、恢复 baseline、不可变 snapshot、单 launch/self 及效果边界已有实现依据。
- **Fixed：**无；本次只读。
- **critical/unresolved：**C1，1 项。
- **本单元 verdict：BLOCK。**
- **B3–B9：**仅保留后续责任，本次未重查，未用于阻塞本单元。