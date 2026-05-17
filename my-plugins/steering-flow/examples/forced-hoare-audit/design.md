# 强制版 `/hoare-audit` Steering-Flow 设计宪章 v4

## 0. 立宪起点

`/hoare-audit` 的价值来自可复查的证明链。只要 Agent 可以跳过门、压缩挑战、忘记接受/拒绝某个 finding 的理由，或不写中间报告就进下一步，审计就退化成普通代码审查。

强制版的承诺：把所有过程事实落到 markdown 文件里，把所有路由事实落到「两个目录」里。

### 现实缺口

老版 prompt 已经有正确形状，但靠语言约束。老版宪章 v2 把 30 多个 Tape 键列在路由协议里，反而把工程参数写进了立宪层。

v3 的修复：Tape 只承载位置，不承载状态。所有状态属于文件系统中的 markdown 报告。

### 边界

本文不替代 `/hoare-design`，也不替代 YAML 实现。本文定义强制版 `/hoare-audit` 的承诺、原则、对象、目录契约和阶段交付件。

### 读者与约束对象

读者：flow 实现者、审计 Agent、复查者。

被约束者：主审 Agent、独立审计 Agent、挑战/反挑战 Agent、修复 Agent、人类决策者。

## 1. 宪法原则

### P1. 事实落在文件，不落在记忆

每条审计事实必须写入 markdown 文件。Agent 不能凭说服性叙述前进。

### P2. 审计有两个目录

- **Target Dir**：被审计对象。审计存在的全部理由。
- **Working Dir**：审计过程的所有产物。Working Dir 可以在 Target Dir 内部，也可以在仓库根。Working Dir 由 setup 阶段搜索并明示选择。

Target Dir 和 Working Dir 是审计的全部位置事实。除此以外，Tape 不承载状态。

### P3. 没有 Lv3 design report，不开始审计

层级框架参见 `prompts/meta-principles.md`。`/hoare-audit` 工作在 **Lv3 ↔ Lv4** 一致性验证：Lv3（design report，方案层）描述代码应当做什么，Lv4（YAML / 代码 / 实现）是被审计的对象。

Lv3 是 `/hoare-audit` 的硬底线 spec：缺则先用 `/hoare-design` 还原再继续。

Lv0 / Lv1 / Lv1.5 / Lv2 不进入 audit 输入：

- 它们属于 `/charter-craft` 域，是制宪产物。
- 在 audit 中只承担**仲裁杠杆**作用：当某条 finding 指向「Lv3 本身可疑」时，可按 `meta-principles.md` 的 M-Discover 上溯，借 Lv2 / Lv1 / Lv1.5 缩小可行方案集合。
- 没有 Lv1 / Lv2 不阻塞 audit。代价是更多歧义会被推到 Decisional gate 让用户拍板。
- `/hoare-design` 只产 Lv3 descriptive spec，不产 Lv1 / Lv2。

### P4. 原始与重建必须可区分

Working Dir 中的 Lv3 design report 必须显式标注来源：

- `origin: original` — 项目里既有的 Lv3 文档，已 cp 到 Working Dir。
- `origin: reconstructed` — 由 Agent 通过 `/hoare-design` 从 Lv4 还原。

如果用户主动放入 Lv1 / Lv2 reference materials 作仲裁参考，同样标注 origin；但它们不参与 spec_gate 校验。

防止：未来读者把还原文档当成既有契约，把既有契约当成可改的草稿。

### P5. Multi-path Whole Audit

不再做「3–6 维度」式切片。每个 fresh 审计 Agent 拿到完整规格 + 完整 Target Dir，从一个明示视角独立写一份完整审计报告。

视角是路径名称（例如 functional / cross-boundary / crash / resource / adversarial），不是把代码切成块。

### P6. 接受 finding 前必须先反证

候选 finding 必须经过 challenge 和 counter-challenge。没有反证的 finding 不能进入修复或决策。

### P7. Finding 必须是 Hoare 对象

有效 finding 必须指向 Lv3 design report 中具体的 Pre/Post/Invariant 或跨边界契约，并给出部署上下文下的反例。否则只能进 nit/hardening。

### P8. 先归因，再分类

候选先去重、找 root cause、剔除症状，再分 Non-Decisional 与 Decisional。

### P9. 代码 finding 必须被钉住

修复后的代码 finding 必须有回归测试、性质测试、可复现脚本，或显式说明为什么不能 pin。

### P10. 人类门只处理真正决策

只有规格冲突、架构取舍、公开 API 契约改变、行为边界变化、接受风险才进 interactive human gate。

## 2. 可推导设计原则

### D1. setup 阶段必须先确定 Target Dir 和 Working Dir

推导：P1（事实落文件）、P2（两个目录）。

setup 状态首先尝试在以下顺序中确定 Working Dir：

1. 用户指定。
2. Target Dir 内的 `audit/` 或 `.audit/`。
3. 仓库根的 `docs/audit/<audit-id>/` 或 `.pi/audits/<audit-id>/`。

setup 阶段必须创建 Working Dir，并在其中产生第一份报告 `setup.md`。

### D2. Tape 只有两个键

推导：P1（事实落文件）、P2（两个目录）。

Tape 仅持有 `TARGET_DIR` 和 `WORKING_DIR`。所有其它过程事实由 markdown 报告承载，门禁通过「Working Dir 中是否存在指定文件」推断。

### D3. Working Dir 有固定一级骨架

推导：P1、P2、P4、P5。

```
<WORKING_DIR>/
  setup.md
  spec/
    lv3-design-report.md      # 必需 (Lv3 方案层)
    index.md                  # 列出所有 spec 文件 + origin
    <…可选: 用户放入的 Lv1/Lv2 参考材料、cp 进来的原始文档…>
  audit/
    <perspective-name>.md
  challenge/
    <finding-id>.md
  counter/
    <finding-id>.md
  findings/
    candidates.md
    confirmed.md
    rejected.md
    decisional.md
    non-decisional.md
  fix/
    plan.md
    patch-report.md
    pinning.md
  verify/
    verify.md
  decision/
    request.md
    answer.md
  circuit-breaker.md           # 仅在触发时存在
  correctness-audit.md
```

骨架是契约，文件存在与否就是门禁信号。

### D4. 每份 markdown 用 frontmatter 标注本质字段

推导：P1、P4、P5、P6。

```
---
audit_id: <id>
round: <N>
state: <state-id>
actor_id: <agent or session id>
fresh: true|false
origin: original|reconstructed   # 仅 spec/ 下文件需要
status: <gate-relevant single token>
inputs: [<list of paths the actor was allowed to read>]
---
```

frontmatter 是结构化事实，gate 脚本读它而不是 Tape。

### D5. 多路审计输入是完整规格 + 完整 Target

推导：P5。

每个 audit perspective 看到 `spec/` 全部文件 + `TARGET_DIR` 全部内容。视角差异通过 prompt 与 frontmatter `actor_id` 区分，不通过裁剪输入。

### D6. Challenge 默认不读 audit 报告

推导：P6。

Challenge 与 counter-challenge 的 fresh agent 默认输入 = `spec/` + `TARGET_DIR` + 该 finding 的 claim。原 audit 报告只在 challenger 主动请求并记录到 frontmatter `inputs` 时才提供。

### D7. 循环必须产出新文件

推导：P1、P8、P9。

返回上一阶段必须新增至少一份 markdown（新 plan、新 patch-report、新 verify、新 spec revision）。空转不被视为循环。

### D8. 最终报告引用，不替代

推导：P1。

`correctness-audit.md` 必须引用 Working Dir 中的具体文件（相对路径）。它是综合，不能删除中间证据。

## 3. 核心设计对象

### Audit Instance

一次审计运行。

本质字段：`audit_id`、`TARGET_DIR`、`WORKING_DIR`、`round`、`status`。

不变量：除 `TARGET_DIR` 和 `WORKING_DIR` 外，无其它 Tape 字段。所有审计产物在 `WORKING_DIR` 内。

### Spec Document

规格文件。位于 `WORKING_DIR/spec/`。

本质字段：`level` ∈ {lv3}（强制），`origin` ∈ {original, reconstructed}、`source_path`（如为 original，记原始位置）。可选附带的 Lv1 / Lv2 参考材料同样使用此对象，但不参与门禁。

不变量：缺 Lv3 design report 即视为缺规格，必须经 `/hoare-design` 补齐。

### Audit Report

某个视角的完整审计报告。位于 `WORKING_DIR/audit/<perspective>.md`。

本质字段：frontmatter 全部、视角说明、检查到的契约、发现的候选 finding 列表。

### Finding

一个结构化正确性主张。位于 `findings/*.md` 中以 finding-id 索引。

本质字段：`finding_id`、`perspective`、`contract_kind`（pre/post/invariant/cross-boundary/persistence/security/resource）、`violated_contract`、`counterexample`、`runtime_reachability`、`deployment_applicability`、`evidence_paths`、`status`。

### Challenge / Counter

针对单个 finding 的反证报告。位于 `challenge/<finding-id>.md`、`counter/<finding-id>.md`。

本质字段：frontmatter 全部、verdict ∈ {upheld, weakened, rejected, inconclusive}、理由、引用的源码/规格行号。

### Decision Item

经归因后仍需人类判断的 root finding。位于 `decision/request.md`，回答位于 `decision/answer.md`。

本质字段：`decision_id`、关联 finding、情境、选项、推荐、规格/架构影响、需要回答的问题。

## 4. Tape 协议

```
TARGET_DIR     # 被审计目标的目录
WORKING_DIR    # 审计产物根目录
```

仅此两键。其它一切由 `WORKING_DIR` 下文件存在性 + frontmatter 字段表达。

setup 状态必须把这两个值写入 Tape；后续状态不再修改它们。

## 5. 阶段与交付件

阶段编号即步骤编号。每步只列「没有它就不能进下一步」的交付件。

### 1. setup

目的：确定 Target Dir、Working Dir、初始 audit_id。

交付件：

- `WORKING_DIR/setup.md`（含 audit_id、Target Dir 路径、Working Dir 选择理由）
- Tape：`TARGET_DIR`、`WORKING_DIR`

门禁本质：没有目录和 setup.md，不允许进入审计。

### 2. spec-gate

目的：把 Lv3 design report 集中到 `WORKING_DIR/spec/`。

交付件：

- `spec/lv3-design-report.md`（必需）
- `spec/index.md`（列出所有 spec 文件、各自 origin、覆盖范围、缺口）
- 若 Lv3 不存在，运行 `/hoare-design` 还原，frontmatter 标 `origin: reconstructed`
- 用户可选放入 Lv1 / Lv2 参考材料以辅助仲裁；它们 cp 到 `spec/`，标 `origin: original`，不参与门禁

门禁本质：缺 Lv3 design report 不允许进入审计；已有但仅在原位置存在的 Lv3 必须 cp 到 `spec/` 才算通过。

### 3. audits（multi-path whole audit）

目的：从多个独立视角各产出一份 whole audit。

交付件：

- 至少 2 份 `audit/<perspective>.md`
- 每份 frontmatter 必须有 `actor_id`、`fresh: true`、`inputs: [spec/, <TARGET_DIR>]`
- 每份末尾列出 candidate findings（finding-id、契约、反例、可达性）

门禁本质：少于 2 份独立 whole audit 不允许进入下一步。

### 4. compile

目的：把 audit 报告里的 candidates 合并成 `findings/candidates.md`。

交付件：

- `findings/candidates.md`（结构化 finding 列表 + 每条来源 audit 文件）
- `findings/rejected.md`（前置筛除项：无契约、不可达、非威胁模型）

门禁本质：未结构化整理的 finding 不能进 challenge。

### 5. challenge

目的：对每个候选 finding 做 fresh 反证。

交付件：

- 每个 candidate finding 一份 `challenge/<finding-id>.md`
- frontmatter 含 `actor_id`、`fresh: true`、`inputs`（默认 spec + target）、`verdict`

门禁本质：未被挑战的 finding 不能晋升。

### 6. counter-and-verify

目的：对幸存或有争议的 finding 做 counter-challenge，并由主审核对关键证据。

交付件：

- 每个幸存 finding 一份 `counter/<finding-id>.md`
- `findings/confirmed.md`（仅 counter 后仍 upheld 的）
- `findings/rejected.md` 追加被驳回项

门禁本质：未经 counter 与主审复核的 finding 不能进入归因。

### 7. reduce-and-classify

目的：去重、归因、分类。

交付件：

- `findings/non-decisional.md`
- `findings/decisional.md`

门禁本质：raw candidate 不允许直接被分类。

### 8. fix-pin-verify

目的：修复 Non-Decisional + 钉住代码 finding + 验证。

交付件：

- `fix/plan.md`、`fix/patch-report.md`
- `fix/pinning.md`（每个代码 finding → 测试或不可 pin 理由）
- `verify/verify.md`（命令、结果、失败、无关既有失败）

路由：

- 验证失败回到本步重新修复（产出新版 plan/patch/verify）。
- 验证通过且修复改变行为边界，回到 spec-gate。
- 验证通过且 `decisional.md` 非空，进 decision-gate。
- 验证通过且 `decisional.md` 空，进 final。

门禁本质：没有验证报告不能声明已修复。

### 9. decision-gate（按需 interactive）

目的：把不可自动解决的 root finding 交给人。

交付件：

- `decision/request.md`（情境、选项、推荐、影响、必答问题）
- `decision/answer.md`（人类回答）

路由：人类回答更新规格/架构后回到 spec-gate；人类暂不决策则 final 状态记 `blocked_decision`。

门禁本质：架构与价值取舍必须显式化。

### 10. final-synthesis

目的：综合 Working Dir 中证据为最终报告。

交付件：

- `correctness-audit.md`，含：Executive Summary、Spec Sources（带 origin 标注）、Target Profile、Confirmed Findings & Fixes、Rejected/Inconclusive、Decision Log、Test Pinning Map、Remaining Limitations、Assumptions、Artifact Index（相对路径）

门禁本质：最终报告必须引用 Working Dir 中的真实文件。

### 附加：circuit-breaker（按需触发）

同一模块在连续若干 round 仍出 confirmed finding 时，必须先写 `circuit-breaker.md` 解释系统性原因，再决定是继续修、改规格还是改架构。

## 6. 推荐状态机骨架

```text
$START
  -> setup
  -> spec_gate
  -> spec_router
       lv3_ready          -> audits
       lv3_missing        -> hoare_design -> spec_gate
       conflict_or_human  -> interactive_spec_decision -> spec_gate
  -> audits
  -> compile
  -> challenge
  -> counter_and_verify
  -> reduce_and_classify
  -> fix_pin_verify
  -> post_verify_router
       fail               -> fix_pin_verify
       pass + decisionals -> decision_gate -> spec_gate
       pass + boundary    -> spec_gate
       pass + clean       -> final_synthesis
  -> final_synthesis
  -> $END
```

Router 是零成本路由；具体 steering-flow 实现选择留给 YAML 层。

## 7. 反膨胀约束

- 一份报告能支撑门禁就不拆。
- Tape 只放两个目录。
- 不固定 perspective 数量上限；至少 2 份是底线，超出由项目决定。
- 不把所有不确定性推给人类；先 challenge、counter、verify。
- 不允许没有新文件的循环。
- Fresh agent 默认只读 spec + target；扩展输入必须写入 frontmatter `inputs`。

## 8. 留给实现层的选择

- Working Dir 默认搜索顺序（D1 给了一个推荐顺序，可被项目覆盖）。
- challenge / counter 的 fresh agent 数量。
- finding 索引文件用 markdown 还是带 yaml block 的混合格式。
- `/hoare-design` 是嵌套 steering-flow 还是外部 interactive 任务。
- helper 脚本是否检查 frontmatter 字段、Working Dir 路径合法性、文件 origin 标签一致性。

---

# v4 增量：机械收敛 + counter 增强 + 经验积累

本节是 v4 在 v3 之上的增量。术语层级遵循 `prompts/meta-principles.md`（Lv0 / Lv1 / Lv1.5 / Lv2 / Lv3 / Lv4）。

本设计文档自身处在 **Lv3**（方案）。本节把 v4 dogfood 中暴露的现实碰壁固化为：

- 新的 **Lv1.5 经验公理**（§9）
- 由 Lv1.5 + 已有 Lv1（§1 P1–P10）派生出的 **Lv2 设计原则**（§10 P11–P15）
- 与之绑定的 **Lv2 推导设计原则 D9–D13**（同样落在 §10）
- v4 的修订日志与 M-Discover 上溯链（§11）

YAML / helper / 状态机 entry-clear 等 **Lv4 实现**留给 `forced-hoare-audit.yaml` 与 `examples/scripts/`。

## 9. Lv1.5 经验公理（v4 dogfood 观察）

层级位置：Lv1.5。来源：v3 实测自审 `my-plugins/steering-flow` 的真实运行。

这些是 **现实碰壁产物**，不是先验武断。它们不质疑 §1 的 Lv1，也不被 Lv1 否决，是独立分支，与 Lv1 共同支撑 §10 的 Lv2 推导。

### O1. 不机械收敛的「下一轮」会无限循环

现象：v3 的 `post_verify_router` 在 `decisional.md` 非空 → `decision_gate` → 回 `spec_gate`，但「是否还有未处理的 Non-Decisional」由 LLM 自述。dogfood 中 round 1 处理完一批 Non-Decisional，路由回 `spec_gate` 后 round 2 又自由发挥提了新的 Non-Decisional，没有任何 round-over-round 的减少证明。LLM 在「我已经做完」与「再多挖一些」之间的判断不稳定。

固化为公理：**「轮次结束」不能由 LLM 的叙述判定，必须由可机械观测的计数推导。**

### O2. counter-challenge 容易把真问题驳回

现象：v3 中我自己挖的 finding 在 fresh challenger 一句话内被否；但反过来同一个 fresh challenger 也容易把对的 finding 驳回，理由是「找不到 spec 明确条款 → 视为 nit」。

固化为公理：**counter-challenge 的失败模式是「为反而反」，而不只是「漏挑战」。强制版必须显式抵御「越改越坏」。**

### O3. 没有提交清单，Non-Decisional 修复会引入退化

现象：v3 在 `fix_pin_verify` 阶段，若有多个 Non-Decisional 改动点，LLM 倾向一次性改完再 verify，verify 通过即放行，但其中部分改动其实是「为了改而改」，没有反例支撑。

固化为公理：**Non-Decisional 改动点的「方案确认」与「修复执行」必须分离；方案必须独立审核；一个审核员一次只能负责少量改动点。**

### O4. 经验若不写文件，三个独立 fresh 角色会重复同样的反驳

现象：v3 round 2 audits 的 fresh agents 重新提了 round 1 已经被 user reject 过的 finding 形态。Fresh agent 没有「上轮经验」是它的设计目的，但「**已被反驳/裁决/否决**」属于事实而非偏见，不传给它就是事实丢失。

固化为公理：**「rejected / overruled / resolved」是事实层信息，必须以文件形式跨 round 跨 fresh agent 持久化。Fresh agent 不能拒读这类文件。**

### O5. Tape 写入若不在 entry 强制清空，会被旧轮次数据污染

现象：在 dogfood 中如果让 LLM 自己负责「轮次开始时把上轮计数清零」，它常常忘记或部分清零。而当一个非决策门禁依赖「LLM 显式提交 0」时，旧值残留就等于跳门。

固化为公理：**任何「LLM 必须显式提交」的 tape 计数变量，进入对应状态时引擎必须先把它清成无效值（如 -1 或删除）；LLM 未提交则门禁必须拒绝转移。**

## 10. Lv2 设计原则（v4 新增）

层级位置：Lv2。下文每条都标注 **派生来源**（Lv1 中的 P# / Lv1.5 中的 O#），并陈述「为什么这条进入视野」（M-Conscious 要求）。

### P11. 「轮次结束」是机械计数，不是 LLM 自述

推导：P1（事实落文件）+ O1（自述会循环）。

为什么进入视野：P1 把事实从记忆移到文件，但「这一轮还有没有问题」本身是个统计事实而非叙述事实。v3 把它留给了 LLM 自述层。

规则：在 challenge / counter / reduce 阶段每完成一次循环，必须显式提交两个数：本轮累计 **Non-Decisional 数量** 与 **Decisional 数量**。两者均为 0 才允许进入 `final_synthesis`；Non-Decisional > 0 则必须回到 fix-pin-verify 路径；Non-Decisional = 0 ∧ Decisional > 0 才进 `decision_gate`。

### P12. 计数变量进入即清空

推导：P11 + O5。

为什么进入视野：P11 要求门禁读「LLM 显式提交的数」。但只要这个数曾经被写过，下一轮如果 LLM 忘记提交，门禁就会拿旧值放行。

规则：在每个 counted-gate 状态的 entry 时刻，引擎层（不是 LLM）必须把对应 tape 计数键清成无效值（推荐 `-1`，或直接删除，二者等价；选择留给 Lv4）。LLM 必须在该状态内显式 `save-to-steering-flow` 写入新数值才能转移；门禁条件必须显式拒绝 `-1`。

### P13. counter-challenge 必须双向抵御退化

推导：P6（接受前必先反证）+ O2（counter 容易为反而反）。

为什么进入视野：P6 已经要求反证，但只单向考虑「漏挑战」，没考虑「过挑战」。O2 显示「过挑战」会让真问题进 rejected。

规则：counter-challenge 阶段必须同时检查两类失败：(a) finding 是否有 Lv3 契约支撑；(b) 反驳本身是否构造了反例 / 引用了 Lv3 / Lv4 行号。仅凭「spec 没明说」不构成有效反驳。模糊不决一律标 `inconclusive` 而不是 `rejected`，并强制进入主审复核。

### P14. Non-Decisional 方案必须经独立确认，且单人负载有上限

推导：P8（先归因再分类）+ P9（修复钉住）+ O3（一次改太多会退化）。

为什么进入视野：P8 + P9 已经覆盖「修复要可验证」，但没覆盖「方案本身是否必要、是否引入退化」。O3 暴露了这个缺口。

规则：在 `fix-pin-verify` 之前插入独立 **Non-Decisional 方案确认** 步骤：

- 每个独立 fresh confirmer 一次最多负责 **3 个改动点**。
- 每个 confirmer 必须为其负责的每个改动点输出三件事：必要性论证、是否引入退化的判断、修复方案是否被现有 Lv3 契约直接蕴含。
- 若某改动点在 Lv3 中没有任何契约依据，confirmer 可以谨慎建议把该改动点上调成 Decisional（带理由），但不能擅自删除或改写它。
- 「文档没提的就需要决策」是默认裁决，不是默认放行。

### P15. 三类经验事实必须以文件形式跨轮跨角色持久化

推导：P1（事实落文件）+ O4（不持久化的经验等于事实丢失）。

为什么进入视野：P1 把当前轮事实落文件，但「这条 finding 上一轮被 reject 了」是跨轮事实。Fresh agent 的「fresh」仅指对 audit 报告无偏见，不应该让它对历史裁决也无偏见。

规则：Working Dir 维护一份只增长的 `lessons.md`（结构尽量简单，逐条 append）。三类内容必须 append：

- **rejected**：counter-challenge 把 finding 驳回的核心理由 + 引用的 spec/code 位置。
- **overruled**：用户在 `decision_gate` 否决的方案 + 否决理由。
- **resolved**：经 fix-pin-verify 已修复的 Non-Decisional 摘要 + pin 测试位置。

challenge / counter-challenge / Non-Decisional 方案确认这三个 fresh 角色，**入参必须包含 `lessons.md`**，并在 frontmatter `inputs` 中声明。`lessons.md` 不取代 `findings/rejected.md` 等结构化档案，它是面向 fresh 角色的「不要再重复提同一形态问题」摘要。

## 10b. v4 推导设计原则（D9–D13）

这些是把 §10 的 Lv2 原则落到 §3 设计对象 + §4 Tape 协议 + §5 阶段交付件上的具体推导。仍是 Lv2 层。

### D9. Tape 增加两个计数键，但仍不承载状态

推导：P11、P12 + D2（Tape 仅持有位置）。

严格地说 D2 不再是「2 键」而是「2 + 2 键」：

```
TARGET_DIR
WORKING_DIR
NON_DECISION_COUNT   # 当前轮已确认的 Non-Decisional 数；进入 counted-gate 时被引擎清成 -1
DECISION_COUNT       # 当前轮已确认的 Decisional 数；进入 counted-gate 时被引擎清成 -1
```

这两个计数键依然不承载「状态」——它们只承载「**本轮门禁观测的两个整数**」，是 P11 的最小机械门禁所必需。所有真实事实仍在 markdown 文件里。

### D10. counted-gate 的 entry-clear 协议

推导：P12 + D9。

实现层（Lv4）必须为每个读取 NON_DECISION_COUNT / DECISION_COUNT 的 gate state 在 entry 时无条件写入 `-1`（或 unset）。这一动作不依赖 LLM 配合。

Gate 转移条件必须形如「值 ≠ -1 且满足某断言」，而非「值满足某断言」。

### D11. 收敛拓扑

推导：P11、P14。

推荐拓扑（具体 YAML 由 Lv4 决定，但必须保留语义）：

```
... -> reduce_and_classify
        -> nondecisional_confirm           （独立 fresh confirmers，每人 ≤3 改动点）
        -> fix_pin_verify
        -> count_gate（entry-clear NON_DECISION_COUNT / DECISION_COUNT）
             LLM 必须 save NON_DECISION_COUNT, DECISION_COUNT
             ND > 0           -> 回 fix_pin_verify
             ND = 0 且 D > 0  -> decision_gate -> spec_gate
             ND = 0 且 D = 0  -> final_synthesis
```

关键不变量：从 `count_gate` 出去的每条边都对计数有显式约束；不存在「LLM 自由判断本轮结束」的边。

### D12. Working Dir 骨架增量

推导：P14、P15。

在 §5 D3 骨架基础上追加：

```
<WORKING_DIR>/
  ...
  confirm/
    <confirmer-id>.md          # Non-Decisional 方案确认报告，frontmatter 列出 owned_findings ≤ 3
  lessons.md                   # 单文件只增长经验簿（rejected / overruled / resolved）
```

### D13. fresh 角色 inputs 强制包含 lessons.md

推导：P15。

`audit/`、`challenge/`、`counter/`、`confirm/` 阶段所有 fresh agent 的 frontmatter `inputs` 必须包含 `lessons.md`（即使该文件为空亦写入路径）。这条由 helper 脚本在 gate 阶段机械检查。

## 11. v4 修订日志与 M-Discover 链

层级位置：本节遵循 `meta-principles.md` 第四节「修宪流程」。

### 修订触发

现实碰壁来自 dogfood 自审 v3：

- 现象 ↔ 公理对应：O1 ↔ 路由空转、O2 ↔ counter 误杀、O3 ↔ 修复退化、O4 ↔ fresh 角色重复反驳、O5 ↔ tape 旧值污染。
- 这些现象在 v3 的 Lv2（§2 D1–D8）+ Lv1（§1 P1–P10）下加不下去。

### M-Discover 上溯结果

- O1 / O5 上溯到 P1 不变（事实落文件仍正确），但 P1 没有展开「计数事实」的子情形 → 派生新 Lv2 P11、P12。
- O2 上溯到 P6 不变（必须反证仍正确），但 P6 没有展开「反证本身的失败模式」→ 派生 Lv2 P13。
- O3 上溯到 P8 + P9 不变，但缺「方案层」环节 → 派生 Lv2 P14。
- O4 上溯到 P1 不变，但 P1 没有展开「跨轮事实」子情形 → 派生 Lv2 P15。

所有上溯都没有触动 Lv0（根本问题）与 Lv1（§1 公理），仅在 Lv1.5 增了 5 条经验公理，并在 Lv2 增了 5 条新原则 + 5 条派生设计原则。

### 影响 Lv4

- `forced-hoare-audit.yaml`：必须新增 `nondecisional_confirm` 与 `count_gate` 两个状态；`count_gate` entry 必须清 `NON_DECISION_COUNT` 与 `DECISION_COUNT`；所有读这两个键的 condition 必须先拒绝 `-1`。
- `examples/scripts/`：新增 `require-tape-key-eq.mjs`、`tape-key-set.mjs`（或等价 entry-set helper）、`append-lessons.mjs`、`require-lessons-in-inputs.mjs`。
- 引擎层（已在 v4 dogfood 修复）：load 工具入口需对 Windows kill-tree 限制做一次性 notify；这点属于 Lv4 实现的稳健性，不进入 Lv2。
