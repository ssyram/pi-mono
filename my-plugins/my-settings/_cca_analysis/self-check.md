# self-check.md — 交付门核对（RUN 2026-10-15）

## 一、manifest 覆盖对账（逐一核对，非计数断言）

- **函数**：manifest.json 39 条 kind=function ↔ 39 个 `_cca_analysis/fn-*.md`，逐名核对齐全且全部非空（3.7KB–16.7KB）；每函数对应 `edges/<stem>.json` 39/39（edge_audit `--strict-existence` PASS：39 fn / 39 edge-delta / 10 join 派发边 / 无半边悬空 / 无未解析注册回调）。
- **外部**：manifest 44 条 kind=external ↔ 44 个 `external-<name>.md` 一一对应；另 6 个为协议允许的 fp 目标补录（appendEntry、getBranch、on、bind、catch、withFileMutationQueue——均不在 manifest externals 名单，由 worker 报告/主 agent 兜底，见各文件头 provenance）。
- **skipped**：150 条，全部位于 `test/`，理由 `test|example`（gen_manifest 自动排除），无生产文件被跳过。
- **提取器命名核查**：39 条全部命中真实定义；7 条为匿名闭包按调用点 callee 命名（catch L39、extension L16 resolver、extension L82 shutdown、queue L51、map L65、service on L21、value L57），各 fn 报告均已写明真实构造，无静默遗漏。
- **工作集**：entries.json 34 入口 + 5 内部 helper（kindOf/readDataFields/loadFile/filePathFor/saveFileOnly，各注明唯一 caller 与可达路径）；39 = 34 + 5，闭合。

## 二、SP 段质量抽查

- 全部 39 个 fn 文件含「霍尔逻辑」SP 段（grep -L 零命中）。
- 敷衍词扫描：10 处「同上」命中逐条人工核对，均为同一报告内已完成论证的回指（带 source:line 锚点），非省略占位；无「待补/TODO/（略）」。
- 门禁格式归一（主 agent，内容零改动）：39 个 fn 文件统一补 YAML frontmatter（fn/source/line/run/date 元数据），标题「## 调用者驱动契约」归一为「## 契约（调用者驱动）」以满足 manifest_check 段锚（## 综述 / ## 契约 / ## 并发）；归一后四门全过（edge_join 107 边稳定 / edge_audit PASS / coverage_audit PASS / manifest_check OK）。

## 三、owner 判据结论

- **不向外 throw/reject**：39/39 满足；全仓生产源 0 显式 throw / 0 Promise.reject（六批独立 grep 验证，报告归档于各 fn 文件）。
- **失败形态**：全部为结构化 SettingsResult/SettingsOutcome error 或 reportSettingsError 安全诊断；诊断自身不抛（C 批全定义域证明，A 批载重前提闭环）。
- **语义对照 arch/prototype.md**：合并序/scope=global 不读 local/kind 过滤/来源跳过/坏日志条目跳过/五个 save 操作/日志仅 {values}/坏原文件不覆盖/无 PARTIAL_SAVE——逐条通过；4 处非违例分歧 + 2 处文档缺口见 open-questions.md（均带 source:line 锚点，无静默降精）。

## 四、前提传播台账（[SELF]，全部闭环）

1. settingsFailure/reportSettingsError 不抛（A 提出 → C 证明，无条件）。
2. copySettings/pickValidFields ok ⇒ 良构 Settings 快照（C 提出 → D 定理证明）⇒ client.ts:58 不可达。
3. readSettingsFile/writeSettingsFile 恒 settle（C 提出 → D 逐 await 枚举证明）。
4. executeSettingsQuery/executeSettingsSave 在 PRE-A 下恒 settle fulfilled 且结果良构（C 提出 → E/F 证明；appendSessionSettings 同步无 await）。
5. 三端口不抛 + 门→用同步（B 提出 → E/F 调用点逐一核实，无 yield 点）。
6. resolver 实参先形校验（B 提出 → C 在 settings-service.ts:26-33 确认）。
7. 总线同步派发 + accept 在 emit 窗口内（A 提出 → event-bus.ts:15-17 + handler :25/:46 实证闭环）。
8. bind 构造位点不在 try 内（F 对 external-bind.md 的修正注记）——仅 PRE-B 类型说谎域可达，如实记录。
9. open-questions.md「join 后诊断」：所有 registered_as 回调可自入口到达，无断链、无死代码候选。

## 五、潜在 bug / 偏差

- **偏差（显式 throw/reject 或判据违反）：无。**
- 图修正记录：worker E 曾将 caller 关系反写为 map→executeSettingsQuery direct 边（自标 reverse-of-caller），污染 join 产生假环——主 agent 将其移入非 join `notes` 字段并从 pristine base 重灌富图（最终 107 边 / 39 SCC / 2 环，两环均为已锚点的外部调用假自环）。

## 六、unknown 汇总（单列，均属宿主/环境域，不计 JS 异常合同）

见 open-questions.md §运行期 unknown；要点：宿主加载 vs 首个 session_start 竞态（missed-bind）、fs/队列 promise 永不 settle（全链无超时）、console.error 后宿主 stderr 异步态、dispose 幂等/emit-dispose 竞态、注册期同步回放 backlog、原型链投毒（Array.prototype.toJSON/map）、revoked Proxy（kindOf PRE 域）、双 realpath TOCTOU 与 isCurrent :63→:66 残余提交窗口、宿主 OOM/终止。

## 七、图与边数据

- callgraph.json：39 节点 / 107 边 / 39 SCC（2 含环：getBranch、appendEntry 假自环 = sessionManager.getBranch()/pi.appendEntry 外部调用）。
- edge_join：10 条框架派发边全部落边（service 通道、accept 回调、3 生命周期、文件队列、3 session 端口）；direct 边 8 条新增事实（mySettings→svc-register 等）；半边仅 my-settings:ready:v1（仓内无消费者，外部消费，已记录不伪造）。
- 静态图噪声（保留于 base，语义分析不采信）：saveFileOnly→extension bind（bind 名碰撞）、svc-register→bind/accept 归因噪声、两自环——均已在 open-questions.md 与相关 fn 报告声明。
