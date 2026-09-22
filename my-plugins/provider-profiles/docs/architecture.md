# provider-profiles — Architecture（D.root）

本 frame 回答 `principles.md` 的 Q.I.1–Q.I.6：把"原生 provider 的具名账号实例"成立为一组可判定的根层性质，并分解到组件 contract。叶子细化见 `detailed.md`；测试判据见 `test-plan.md`；全局论证见 `correctness.md`。

## D.root — provider-profiles 根设计

### Upstream

- root：Q.I.1 多账号具名实例、Q.I.2 配置驱动、Q.I.3 凭据独立与不静默借号、Q.I.4 官方语义继承、Q.I.5 不修改官方源码与不干扰、Q.I.6 可推理实现。
- parent obligation：无（本层为根）。
- applicable global P：无（上层不存在）。

对象与范围（承 Q.I.1 边界，2026-09-22 泛化）：**账号实例**是 Pi 内以用户配置名命名的运行时 Provider（`id = name`），复用一个**可克隆内置 provider**的认证流程、请求实现与模型目录。支持集为动态判定：全部内置工厂 − 携带 `refreshModels` 者（当前仅 `radius`，Q.A.6）；oauth/apiKey 规则由工厂产物 auth 形状动态决定。**custom 来源（models.json 定义的自定义 provider）不做**（Q.I.7：身份层单一职责）。配置文件为 `~/.pi/agent/provider-profiles.json`（读 + `/add-login` 写）。

### P

#### P.local.1 — 实例身份唯一

**property**：配置中每个合法条目产生且仅产生一个注册 provider，`id = name`；`name` 匹配 `^[a-z0-9][a-z0-9-]{0,63}$`，不等于任何内置 provider 名（denylist 来自 `compat.getProviders()`）、不等于用户 `models.json` 已声明的任何 provider 键（防 overlay 穿透隔离，correctness.md G-02）、不等于宿主凭据存储的保留键（`Object.prototype` 继承属性，如 `constructor`，G-07）。非法/冲突/保留条目逐条失败并产生含条目名的可见错误，其余条目照常注册。（修订 2026-09-22：后两个 denylist 为 G-02/G-07 反例修复后的 contract redesign。）
**condition**：插件加载/重载时对全部条目成立。
**excludes**：静默吞错；坏条目导致全部账号不可用；覆盖内置 id。
**source**：Q.I.1、Q.I.2、Q.I.5；Q.A.3、Q.A.8。

#### P.local.2 — 凭据隔离与显式解析序

**property**：实例认证解析顺序固定：① 本实例存储凭据 → ② 本实例配置 `apiKey`（若有）→ 失败。不得读取环境变量，不得访问其他实例或内置 provider 的凭据槽。`openai-codex` 实例拒绝 `apiKey` 字段（官方认证为 OAuth）。登录/登出/刷新只作用于本实例槽位。
**excludes**：zai 系官方 env 回退（`ZAI_API_KEY` 等）在实例上出现；logout 后静默复活他处 key。
**source**：Q.I.3、Q.I.4；Q.A.1、Q.A.5。

#### P.local.3 — 模型归属重戳

**property**：实例暴露的每个模型满足 `model.provider === name`；其余字段与官方目录对应条目逐字段相等（含 contextWindow、maxTokens、reasoning、thinkingLevelMap、cost、input、compat）。
**excludes**：人工转录默认值化（E1）；模型仍指向内置 id。
**source**：Q.I.4；Q.A.2、Q.A.4；Q.E.1。

#### P.local.4 — 官方语义继承与 id 绑定闭包剔除

**property**：实例复用官方 `login` 流程对象、OAuth 刷新行为与 `stream`/`streamSimple` 实现（引用共享，不复制行为）；实例不携带任何绑定原工厂 id 的闭包（`refreshModels`、`filterModels` 显式不复制）；实例构造采用字段白名单，仅复制经论证与 id 无关的字段。扩充目标 provider 集合前必须对新工厂逐字段重新论证。
**condition**：白名单现限定为：`id`（换为 name）、`name`（显示名）、`baseUrl`、`headers`、`getModels`（重戳版）、`stream`、`streamSimple`、`auth`（按 P2 包装或原样）。
**excludes**：blind spread；复制出行为漂移的平行实现；未来工厂新增字段自动进入实例。
**source**：Q.I.4；Q.A.6、Q.A.7。

#### P.local.5 — 不干扰

**property**：不覆盖或修改任何内置 provider 的注册与配置；不读写除本实例名下凭据槽之外的任何凭据；不写 `my-plugins/provider-profiles/**`、用户配置文件（含 `provider-profiles.json` 与只读的 `models.json` denylist 检查）之外的任何文件。宿主在注册后自行发起的全局 refresh/可用性检查（会读本底槽位、可能迁移旧目录持久化）属宿主行为，见 correctness.md G-05/G-06。（修订 2026-09-22：补入 G-01/G-02 修复引入的 models.json 只读访问与宿主本底行为豁免。）
**excludes**：对内置 id 的任何注册调用；对 `models.json` 既有内容的改动。
**source**：Q.I.5。

#### P.local.6 — 配置驱动与失败可见

**property**：新增账号仅改配置文件。坏 JSON → 插件整体报错且不注册任何实例；条目级错误（未知 provider、坏 name、冲突、oauth+apiKey 组合）→ 跳过该条目并输出含条目名的错误，其余照常。
**excludes**：部分注册而无错误报告；坏 JSON 下半注册状态。
**source**：Q.I.2、Q.I.6。

#### P.local.7 — 缺凭据即不可用

**property**：无凭据实例的模型不出现在 `/model` 可用列表；任何执行路径不得产生"路由到实例 A 的请求实际使用 B 的凭据"的状态。
**source**：Q.I.3；Q.A.4。

**显式非目标**（不入 P）：自动轮换/额度探测/失败转移；扫描外部凭据目录（`.codex-*` 等）；共享外部程序维护的 token；迁移或修改既有 `models.json` 条目；**custom 来源与内联目录定义**（Q.I.7，用户 2026-09-22 裁决）；`/rm-login` 命令（用户裁决：残留风险，删除方法入 help）。

### M

**components**：

- `D.C1` config-loader — contract：读固定路径配置 → `Entry { name, provider, apiKey? }[]` 或整体失败；条目级校验采用调用方传入的 ValidationContext（nameDenylist/modelsJsonIds/supportedSources/oauthSources，均动态构造）；不可识别 provider 一律拒绝；无副作用。implemented-by 详见 detailed.md。
- `D.C2` provider-source — contract：内置工厂分类（支持集 = 全部 − refreshModels 携带者；oauth 形状读取）+ `getBase` 返回缓存的官方工厂产物（只读，不修改）；导入通道 = `providers/all`（Q.A.10）。expands-to：detailed.md。
- `D.C3` instantiator — contract：base + Entry → instance Provider，满足 P2（auth 包装/env 模板展开）、P3（重戳）、P4（白名单）；不发明新协议行为。expands-to：detailed.md（核心正确性承载者，独立展开）。
- `D.C4` registrar — contract：instance[] → 逐个 `pi.registerProvider(instance)`（native 形式）；失败条目级隔离并报告。implemented-by 详见 detailed.md。
- `D.C5` 命令与写入 — contract：`/add-login`（help 面、位置状态补全、同名拒绝、写前整体重校验、即时注册、不可识别来源拒绝）；`config-writer` 读改写 + 原子 rename。expands-to：detailed.md C5。

**composition**：串行单向数据流，无共享可变状态：

```text
json 文本 ─C1→ Entry[] ─×C2→ (Entry, base)[] ─C3→ instance[] ─C4→ 注册
```

C1 整体失败 → 后续阶段不执行 → 零注册、零副作用（P5、P6）。C2/C3/C4 的条目级失败 → 该条目不注册 + 可见错误，其余条目独立完成（P1、P6）。组合后对上保证：合法配置 ⇒ 全部实例注册且各自满足 P1–P7；坏配置 ⇒ 部分或零注册 + 无副作用残留。

### R

**Derivation**（Q + Q.A → P）：
- Q.I.1/2 要求具名、可配置的身份入口；Q.A.1/3 表明 provider id 是凭据与注册的公共主键，故"实例 = 新 provider id + 重绑凭据槽"是满足意图的最小结构（相比自建凭据管理层或改官方源码，依赖面最小，Q.I.5）。
- Q.I.3 与 Q.A.5 冲突点：zai 系官方 resolve 带 env 回退，直接共享会静默借号，故必须包装 resolve（P2）；除此偏离外共享官方对象（Q.I.4）。
- Q.A.2/4/7 表明模型归属戳记决定凭据解析与可用性判定，且不随对象复制改写，故 P3 重戳与 P4 剔除为必要义务。

**Satisfaction**（M ⊨ P，逐条）：
- P1：C1 的校验（name 规则、denylist、查重）+ C4 每实例恰一次注册；条目隔离由 C2/C3/C4 的错误传递保证。
- P2：C3 的 auth 包装（zai 系：login 复用、resolve 收窄为 ①存储 ②配置 key；codex：原样共享，无 env 回退存在）；凭据槽隔离由 P3 重戳 + Q.A.1 的主键机制承接。
- P3/P4：C3 白名单构造 + 重戳 map；`refreshModels`/`filterModels` 不在白名单（Q.A.6/7）。
- P5：C4 只注册实例 id；C1/C3 无外部副作用；全部组件不写范围外文件。
- P6：C1 的两级错误分级（整体 vs 条目）。
- P7：P2 失败路径返回 undefined → 认证未配置 → Q.A.4 快照自动不可用；无其他凭据来源可误用。
- 未 discharge：T1（Q.A.10 子路径解析）、T2（Q.A.11 卸载清理）——均不影响上述论证结构，闭合动作在 detailed.md/实现期。

**Optimality**：
- 候选 A（本方案：官方对象引用 + 白名单改造）：实现面最小，行为漂移面被白名单显式封死。
- 候选 B（重建完整 provider 定义：自导入 api 工厂、自拼模型）：引入 E1 类转录风险与双份维护，被 Q.I.4 排除。
- 候选 C（models.json 复制方案）：无法覆盖 OAuth 多账号（静态 key only），被 Q.I.1 排除。
- 故选 A；其代价（依赖官方对象字段稳定性）已由 P4 的"扩集合须重新论证"承接。

### Expansion

- `D.C3` → detailed.md（instantiator 细化：auth 包装语义、重戳实现契约、字段白名单逐字段论证表）。
- `D.C2` → detailed.md（导入通道与 T1 闭合）。
- `D.C1`/`D.C4` → implemented-by：detailed.md 的函数契约直接落实（无独立设计问题）。
- 全部叶子 → I：`my-plugins/provider-profiles/` 下的实现模块（阶段 3 产出）。
