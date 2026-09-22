# provider-profiles — Detailed Design（叶子细化）

本文件展开 `architecture.md` 的 `D.C2`、`D.C3`，并落实 `D.C1`、`D.C4` 的叶子契约（后两者无独立设计剩余）。全部函数契约按"便于 Hoare 推理"的粒度书写（Q.I.6）：显式 pre/post、副作用、失败出口。

# D.C3 — instantiator（独立展开）

## Upstream

- parent obligation：`architecture.md` C3 contract——base + Entry → instance，满足 P.local.2（auth 包装）、P.local.3（重戳）、P.local.4（白名单）；不发明新协议行为。
- applicable global P：无。

## P

### P.local.3.1 — 重戳纯函数

**property**：`restampModels(models, name)` 返回与输入等长、同序的新数组，每个元素满足 `provider === name` 且其余字段与对应输入元素逐字段相等（浅层共享嵌套对象引用，不深拷贝、不修改输入）。
**excludes**：修改官方模型对象或官方数组；深拷贝引入行为漂移面。
**source**：P.local.3；Q.A.2。

### P.local.2.1 — auth 包装解析序

**property**：zai 系实例的 resolve：① `credential.key` 存在 → 返回 `{auth:{apiKey: credential.key}, env: credential.env, source:"stored credential"}`；② 否则 `entry.apiKey` 存在 → 返回 `{auth:{apiKey: entry.apiKey}, source:"profile config"}`；③ 否则返回 `undefined`。全程不调用 `ctx.env`（不读任何环境变量）；仅在 abort signal 已触发时抛出。`login` 原样复用官方交互（secret prompt）。
**excludes**：env 回退；包装层新增的网络调用、缓存或状态。
**source**：P.local.2；Q.A.5。

### P.local.2.2 — oauth 实例 auth 原样共享

**property**：`openai-codex` 实例的 `auth` 为官方对象的同一引用（不包装、不复制）；且 C1 层已保证该类条目无 `apiKey` 字段，故不存在第二解析来源。
**source**：P.local.2、P.local.4；Q.A.5。

### P.local.4.1 — 字段白名单封闭

**property**：实例对象的自有属性恰为白名单八项：`id, name, baseUrl, headers, auth, getModels, stream, streamSimple`（取值规则见 M 表）；不出现 `refreshModels`、`filterModels` 或任何其他官方字段。
**excludes**：blind spread；未来官方新增字段自动透传。
**source**：P.local.4；Q.A.6、Q.A.7。

## M

```ts
restampModels(models: readonly Model[], name: string): Model[]
wrapApiKeyAuth(auth: ApiKeyAuth, configKey: string | undefined): ApiKeyAuth
instanceProvider(base: Provider, entry: Entry): Provider
```

字段取值表（instanceProvider）：

| 字段 | 取值 | 与 id 无关的依据 |
|---|---|---|
| `id` | `entry.name` | 身份重绑本身 |
| `name` | `` `${base.name} (${entry.name})` `` | 仅显示 |
| `baseUrl` | `base.baseUrl` 引用 | 传输配置，不参与 id 判定（Q.A.6 工厂源码） |
| `headers` | `base.headers` 引用 | 同上 |
| `auth` | zai 系 → `wrapApiKeyAuth(base.auth.apiKey, entry.apiKey)`；codex → `base.auth` 原引用 | P.local.2.1/2.2 |
| `getModels` | `() => restampModels(base.getModels(), entry.name)` | P.local.3.1；每次调用基于官方当前目录重算，动态安全 |
| `stream` | `base.stream` 函数引用 | 仅按 `model.api` 分发（Q.A.6） |
| `streamSimple` | `base.streamSimple` 函数引用 | 同上 |

函数契约：

- `restampModels`
  - pre：`models` 为官方工厂 `getModels()` 产出；`name` 已通过 C1 校验。
  - post：P.local.3.1；无副作用；不抛出（纯数据变换）。
- `wrapApiKeyAuth`
  - pre：`auth` 为 `envApiKeyAuth` 产物（zai 系）；`configKey` 为条目配置 key 或 undefined。
  - post：返回对象的 `login === auth.login`（同一引用）；`resolve` 满足 P.local.2.1；`name === auth.name`。
  - 副作用：无；不抛出（构造即返回）。
- `instanceProvider`
  - pre：`base` 为 C2 产出的未修改官方 Provider；`entry` 已通过 C1 全部校验。
  - post：返回对象满足 P.local.4.1 的封闭白名单及上表取值；`getModels()` 结果满足 P.local.3.1；不修改 `base`。
  - 失败出口：无（数据组装；所有输入已由上游校验）。

## R

**Derivation**：parent P2/P3/P4 直接分解为 3.1/2.1/2.2/4.1 四条可判定性质，无新增义务。
**Satisfaction**：三函数 post 蕴含对应性质（restamp→3.1；wrap→2.1；instance 表→4.1 与 2.2）；白名单封闭性使 Q.A.7 的闭包剔除自动成立。
**Optimality**：相比"克隆后逐字段删除"，白名单构造把"允许什么"收敛为闭集，新增官方字段默认不进入——审查面更小。

# D.C2 — provider-source（2026-09-22 泛化修订：动态分类）

## Upstream

- parent obligation：来源名 → 官方 base Provider（缓存只读）；支持集与 oauth 形状动态推导；不可识别名字可辨认报错；不修改 base。

## P

### P.local.C2.1 — 导入通道（T1 闭合后的形态）

**property**：唯一导入通道 = `@earendil-works/pi-ai/providers/all`（VIRTUAL_MODULES 清单内，Q.A.10）；子路径 `providers/<name>` 被 built 运行时拒绝（T1 负面结论）。通道不可解析属整体环境失败：模块加载即失败。
**source**：Q.A.8、Q.A.10。

### P.local.C2.2 — 工厂分类与缓存

**property**：`sourceInfos()` 惰性构建进程内只读缓存：遍历 `builtinProviders()`，跳过 `refreshModels !== undefined` 者，记录 `{provider, isOAuth: auth.oauth !== undefined}`；`supportedSourceIds()`/`isOAuthSource()`/`getBase()`/`builtinIds()` 均由缓存派生。缓存条目永不修改（工厂无状态，Q.A.6）。
**excludes**：硬编码 provider 清单；对 base 的任何写操作。
**source**：Q.A.6、Q.A.12；P.local.4。

## M / R

- 分类即 P4 泛化的实现载体：新增内置 provider 自动进入支持集，除携带 refreshModels 者。
- 与 `/login` 序列同源性论证见 Q.A.12。

# D.C1 / D.C4 — 叶子契约（implemented-by 本节）

## C1 config-loader（2026-09-22 泛化修订）

```ts
readProfileConfig(path: string): Promise<RawProfileConfig>   // 文件层
parseEntries(raw, validation: ValidationContext): { entries: Entry[]; errors: EntryError[] }
ValidationContext = { nameDenylist; modelsJsonIds; supportedSources; oauthSources }  // 全部由调用方动态构造
```

- `Entry = { name: string; provider: string; apiKey?: string }`（provider 不再是三值字面量联合）；**外层格式为 JSON 对象映射**。条目必须为 JSON 对象，多余字段忽略；`provider` ∉ supportedSources（动态支持集）→ 条目错（"不可识别来源一律拒绝"）；oauthSources 成员携带 apiKey → 条目错。
- 配置内重复 name 被 JSON 对象键唯一性结构性消除（`JSON.parse` 后键必唯一），原 P6 的"配置内不重复"校验不再需要独立错误类，P.local.1 的该子句由结构保证。
- `readProfileConfig`：`ENOENT` → 视为空配置（首次运行体验；P6 只管坏 JSON）；存在但不可解析/非对象 → 抛 `ConfigError`（整体失败，含路径与原因）。
- `parseEntries`：逐条独立校验——name 正则 `^[a-z0-9][a-z0-9-]{0,63}$`、保留键拒绝（`Object.getOwnPropertyNames(Object.prototype)` 精确匹配，G-07）、`provider ∈ SUPPORTED`、`openai-codex` 拒绝 `apiKey`、`name ∉ builtinIds`、`name ∉ modelsJsonIds`（denylist 来自 `agentDir/models.json` 的 providers 键，只读、容错解析，G-02）；每条失败产出 `EntryError { name, reason }` 并跳过，不中断其他条目。纯函数，无副作用。
- `builtinIds` 来源：`compat.getProviders()` 名称列表（Q.A.8），在插件工厂入口一次性取得。

## C4 registrar

```ts
registerInstances(pi: ExtensionAPI, instances: Array<{ entry: Entry; provider: Provider }>): { registered: string[]; failed: EntryError[] }
```

- 逐个 `pi.registerProvider(provider)`（native Provider 形式，Q.A.3）；单个注册抛错 → 记为该条目失败并继续其余（P1 条目隔离）；不使用半注册状态。
- 成功与失败清单返回给工厂层统一输出：条目级错误经 `console.error` 逐条可见（含条目名与原因），整体配置错误由工厂直接 throw（Pi 将扩展标记为失败，P6 两级可见性）。
- 不自动 unregister（Q.A.11 未证实卸载钩子；实例存活至 Pi 退出，README 记录边界）。

# 插件工厂（编排，唯一有副作用入口）

```ts
export default async function (pi: ExtensionAPI): Promise<void>
```

流程（严格串行，对应 composition）：

1. `builtinIds = new Set(getProviders())`；
2. `raw = readProfileConfig(configPath)`（整体失败即 throw，后续不执行）；
3. `{ entries, errors } = parseEntries(raw, builtinIds)`；
4. 对每个 entry：`base = getBase(entry.provider)`（SourceError 归入条目错误）→ `provider = instanceProvider(base, entry)`；
5. `registerInstances(...)`；
6. 条目级错误（步骤 3/4/5 汇总）逐条 `console.error`。

`configPath`：经宿主导出的 `getAgentDir()`（coding-agent 公开 index 导出，VIRTUAL_MODULES 可达）拼 `provider-profiles.json`——G-01 修复：完全镜像宿主 env 覆盖、tilde/file:// 展开语义，不再本地复制。

# C5 — /add-login 命令与配置写入（2026-09-22 增补，同日两轮修订）

- `commands.ts`：`registerAddLoginCommand(pi, configPath, modelsJsonPath)` 注册 `/add-login`；help 面 = {裸, help, h, ?, -h, --help}；参数 2–3 个（name/provider/apiKey，apiKey 单 token）。
- **不可识别 provider 一律拒绝**（用户裁决）：provider ∉ 动态支持集 → declined 诊断，不写文件不注册。
- **补全 = 位置状态模型**（Q.A.13 契约 + 用户裁决的 Markov 式语义）：A 态（命令后仅空白）→ 单个 `help` 候选；B 态（首 token 是 help 前缀）→ `help`；B' 态（首 token 是 NAME，有无尾随空格同权）→ 动态支持集候选且 value 保留 name；D 态（apiKey 位）→ null。`-h/?` 可手输执行但不进候选。
- `config-writer.ts`：`upsertProfileEntry(path, entry, validation)` 读改写——合并结果整体重过 parseEntries(ValidationContext)；本条目相关错误拒写；临时文件 + 同目录 rename。
- 语义：同名存在即拒绝（无静默覆盖）；即时注册经 `pi.registerProvider(instanceProvider(getBase(p), entry))`；`apiKey` 的 `$VAR`/`${VAR}` 在 resolve 时展开（`resolveEnvTemplate`，缺失=未配置；不支持 `!command`）。
- P5 修订：插件获得对自身配置文件的写权限（原子 rename；多会话并发写竞态 = 记录边界）。

# 缺口闭合记录（join 对齐，2026-09-22）

Astra 的 test-plan.md（G-01..G-10）与设计/实现对齐后的裁决；Astra 写作时未读本文件：

- **G-01 已闭合**：外层 = JSON 对象映射（`{ "<name>": { provider, apiKey? } }`）；缺文件（ENOENT）→ 空配置；顶层非对象/数组 → 整体 ConfigError；条目形状错误 → 条目错误。
- **G-02 裁决**：表示结构（JSON 对象键）使校验层重名类不存在；文本层重复键遵循 `JSON.parse` 语义（静默取后者），不新增自定义解析器；P1 的"配置内不重复"由结构承担。
- **G-03 已闭合**：name 恒为字符串（JSON 键）；缺/非字符串 provider → 条目错；空串 name 以 `""` 形式出现在诊断；apiKey 非字符串或空串 → 条目错（同步补强实现）。
- **G-04 裁决**：resolve 对空/缺失存储 key 同等对待（truthiness），空存储 key 视为缺失继续解析序；空字符串配置 apiKey 为条目错误；远端失效/存储访问异常语义归宿主，插件不改写。
- **G-05 已闭合**：整体 = 工厂 throw ConfigError（扩展失败态）；条目级 = console.error 含条目名（C4/工厂节）。
- **G-06 已闭合**：嵌套对象浅共享引用（restamp 契约）；无排序要求。
- **G-07 已闭合**：显示名 `${base.name} (${entry.name})`（字段取值表）。
- **G-08/T1 维持 pending**：vitest 层经 vitest.base 别名到 packages/ai 源码可测工厂真实性（非 T1 本身）；真实闭合在阶段 5 真实 pi 冒烟。
- **G-09/T2 维持 pending**：README 记录"实例存活至进程退出；重载建议重启 Pi"。
- **G-10 裁决**：插件运行时零文件写入；唯一自身读取 = provider-profiles.json；凭据写入全部由宿主在用户显式 /login 时驱动。T-32 哨兵判据 = 无写入。

# 实现单元清单（I 的落点）

```text
provider-profiles/
  index.ts                      # 仅 re-export default（工厂在 extension 模块）
  provider-profiles-extension.ts# 工厂编排（上述 6 步）
  config-entry.ts               # Entry 类型 + parseEntries 校验
  config-loader.ts              # readProfileConfig 文件层
  provider-source.ts            # 静态工厂 import + getBase + SUPPORTED
  instantiator.ts               # restampModels / wrapApiKeyAuth / instanceProvider
  registrar.ts                  # registerInstances
  docs/…                        # 既有四份
  test/…                        # Terra 产出（阶段 4）
  README.md                     # 配置说明、/login、/model、卸载边界（T2）
```

约束承接：每文件 ≤200 行、单一职责、无 utils 桶文件、顶层 import、无 any（Q.I.5/I 纪律）。
