# provider-profiles — Architecture（D.root）

本 frame 回答 `principles.md` 的 Q.I.1–Q.I.7：在不改官方源码、不重写模型目录定义的边界内，把内置 provider 的多个认证身份实现为具名实例。叶子设计见 `detailed.md`；独立测试设计及执行证据见 `test-plan.md` / `test-results.md`；历史 Hoare 审计及后续勘误见 `correctness.md`。

## D.root — provider-profiles 根设计

### Upstream

- root：Q.I.1 多账号具名实例、Q.I.2 配置驱动、Q.I.3 凭据独立、Q.I.4 官方语义继承、Q.I.5 不干扰、Q.I.6 可推理实现、Q.I.7 身份层单一职责。
- parent obligation：无（根 frame）。
- applicable global P：无。

**对象与范围**：账号实例是 `provider-profiles.json` 中以 `name` 命名的 runtime Provider（`id = name`）。它从可克隆的内置 provider 继承认证协议、模型目录及请求实现；它不是远端账号存在性或额度独立性的证明。`models.json` 保留目录/端点/模型覆盖的职责，本插件只读它以判定同名覆盖是否会改变认证或请求来源。

### P

#### P.local.1 — 实例身份与同名覆盖分类

**property**：每个合法 profile 条目至多产生一个 `id = name` 的实例。`name` 必须匹配 `^[a-z0-9][a-z0-9-]{0,63}$`，不得是任一内置 provider id 或宿主存储保留键；同名 `models.json` 条目按内容分类：

- **允许**：仅含 `modelOverrides`，且任一模型覆盖不含 `headers`。这类配置只在实例目录上叠加模型元数据。
- **拒绝**：存在任一 provider 级字段（如 `apiKey`、`baseUrl`、`api`、`headers`、`models`、`compat`、`oauth`、`authHeader`、`name`），或任一模型级 `headers`。这些字段可改变认证、路由、目录或请求头。

非法/危险条目具名报告并跳过；无关合法条目继续。

**excludes**：覆盖内置 id；无条件拒绝纯模型覆盖；让危险同名配置把认证来源注入实例。
**source**：Q.I.1、Q.I.2、Q.I.3、Q.I.5、Q.I.7；Q.A.1、Q.A.3、Q.A.14。

#### P.local.2 — 凭据隔离与可解释的来源序

**property**：对 API-key 型实例，插件自有 resolver 的序为：本实例存储凭据 → 本实例 profile `apiKey`（支持 `$VAR`/`${VAR}`，缺失变量即未配置）→ `undefined`；它不调用官方环境变量回退。OAuth 型实例拒绝 profile `apiKey`，复用官方 OAuth auth 对象。所有实例按其重戳后的 provider id 存取凭据。

**condition**：不包含用户显式 `--api-key` runtime override、同槽 stored 值的宿主环境展开等已记录宿主边界；这些不属于插件静默回退。
**excludes**：从其他 profile、内置 provider 或同名危险 models.json 配置借 key；认证失败后自动换号。
**source**：Q.I.3、Q.I.4；Q.A.1、Q.A.5、Q.A.14。

#### P.local.3 — 目录继承、重戳与显式模型覆盖

**property**：实例的基础目录由官方 `getModels()` 重戳而来：每个模型 `provider === name`，输入目录不被修改。无同名覆盖时，其他模型字段等于官方目录；存在安全同名 `modelOverrides` 时，Pi 在重戳目录上有意叠加这些模型字段，未覆盖字段仍继承官方目录。

**excludes**：手抄模型目录、把模型覆盖误当认证来源、模型仍指向内置 id。
**source**：Q.I.4；Q.A.2、Q.A.4、Q.A.14；Q.E.1。

#### P.local.4 — 官方行为继承与来源分类

**property**：C2 从 `builtinProviders()` 动态构建来源分类：

- 任一带 `refreshModels` 的来源不可克隆（当前为 `radius`），因为恢复目录闭包绑定原 id。
- OAuth/API-key 形状从工厂产物 `auth` 读取。
- 仅 `github-copilot` 的官方 `filterModels` 经源级核验后被受控转发：它按 OAuth credential 的 `availableModelIds` 过滤模型 id，不依赖原 provider id。

C3 使用封闭字段构造实例：`id`、显示 `name`、`baseUrl`、`headers`、`auth`、重戳 `getModels`、`stream`、`streamSimple`，以及在上述 Copilot 条件成立时的 `filterModels` 委托。`refreshModels` 和任何未被 C2 批准的字段不进入实例。

**excludes**：硬编码 provider 清单；blind spread；携带绑定原 id 的刷新闭包；丢失 Copilot 的账户允许模型过滤。
**source**：Q.I.4、Q.I.6；Q.A.6、Q.A.7、Q.A.10、Q.A.12。

#### P.local.5 — 边界内副作用与不干扰

**property**：插件不改内置 provider 注册、官方源码、其他插件、`models.json` 或无关凭据槽。它可：读 `provider-profiles.json`；只读解析 `models.json` 的覆盖内容；经 `/add-login` 原子读改写自己的 profile 文件；调用宿主注册实例。宿主注册后触发的全局刷新、内置槽读取或条件性目录持久化属于宿主边界，须可观察地记录，不能写成插件自身直接写入。

**excludes**：修改 models.json；以修改内置 env 行为实现隔离；隐式保存第二套 token。
**source**：Q.I.5、Q.I.7；Q.A.3、Q.A.14。

#### P.local.6 — 配置、命令与失败可见

**property**：完整配置文件解析失败时零本次注册并向宿主抛整体错误；条目级校验、来源构造或同步注册失败时具名报告、其余条目继续。`/add-login <name> <provider> [apiKey]`：先拒绝不可识别来源、危险同名覆盖、OAuth+key、同名 profile 和不合法输入；随后原子写入自己的配置并立即注册。`/rm-login` 有意不存在，删除步骤在 help 中说明。

**excludes**：静默覆盖同名 profile；不可识别来源被默认映射；命令写入 models.json；坏配置下注册前缀。
**source**：Q.I.2、Q.I.5、Q.I.6、Q.I.7；Q.A.12、Q.A.13。

#### P.local.7 — 无凭据的可用性边界

**property**：在宿主稳定 `all`/`available` 快照中，实例无自身认证来源时不进入 `available`；请求认证仍由实例 resolver 拒绝。`/model` scoped UI 的陈旧显示是宿主通用边界，不等同于请求获准或泄露凭据。

**source**：Q.I.3；Q.A.4。

**显式非目标**：自动轮换、额度探测、失败转移、外部 `.codex-*` 扫描、共享外部 CLI token、custom 来源与内联目录定义、`/rm-login` 命令。

### M

```text
profile config ─C1→ validated entries ─C2→ classified official bases
               └───────────── C5 command/write path ─────────────┘
entries × bases ─C3→ named instance Providers ─C4→ host registration
models.json ──read-only──→ C1 safe/dangerous same-name classification
```

- **C1 config loader / validator**：加载 profile JSON；构造 `ValidationContext { nameDenylist, modelsJsonConflicts, supportedSources, oauthSources }`；读取 models.json 的内容分类而非全键 denylist。
- **C2 provider source**：通过 `@earendil-works/pi-ai/providers/all` 取得内置工厂，缓存只读 base 与分类；拒绝 refreshModels 来源，标记 OAuth 和经过核验的 filter forwarding。
- **C3 instantiator**：重戳模型，包装 API-key resolver，受控转发 Copilot filter，显式省略刷新闭包。
- **C4 registrar**：逐项 native `registerProvider`，同步错误具名收集；异步提交语义属于宿主 R-C4 边界。
- **C5 command / writer**：注册 `/add-login`；按参数位置状态完成 help/provider fuzzy 补全；合并写入前重跑 C1；同目录临时文件加 rename 写入。

### R

**Derivation**：Q.I.1/2 需要可配置、可选的身份入口；Q.A.1/3 给出 provider id 是凭据与模型归属的共同主键，故“新 id + 重戳目录 + 官方行为委托”是最小机制。Q.I.3 与 Q.A.5 的官方 env 回退冲突，故仅对 API-key resolver 收窄来源。Q.I.4 与 Q.E.1 排除手抄模型目录；Q.I.7 排除把目录定义搬进 profile 文件。

**Satisfaction**：C1 防止身份冲突与危险 overlay；C2 给 C3 提供经过分类的只读 base；C3 建立模型、认证与请求行为的同一实例 id；C4 注册；C5 使用同一 C1/C2/C3 规则，所以命令和文件加载不会分叉。安全 `modelOverrides` 由宿主在实例目录上叠加，是 P3 的有意行为；不进入 P2 的认证合成路径。provider 级配置和模型 headers 在 C1 前拦截，防止它们跨越该边界。

**Optimality**：让 models.json 保留模型/端点定义，只让 profile 文件表达身份，消除了目录重复与 OAuth 多账号不足两个相反问题。内容分类而非全键拒绝既保留用户的模型覆盖，又只阻断有证据的认证/请求注入字段。

### Expansion

- C1/C2/C3/C4/C5 的函数级 pre/post、字段表与失败路径见 `detailed.md`。
- 当前独立测试与真实 Pi 证据见 `test-results.md`；原独立审计的适用 revision 和后来勘误见 `correctness.md`。
- I 落点仅为 `my-plugins/provider-profiles/` 下的实现、测试和文档。