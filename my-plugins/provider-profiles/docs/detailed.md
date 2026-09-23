# provider-profiles — Detailed Design（叶子 D）

本文件展开 `architecture.md` 的 C1–C5。每个函数契约只承接 D.root 已分配的义务；不把宿主边界、未来需求或实现便利伪装成新的 P。

## C1 — profile 配置与同名 models.json 分类

### 输入与类型

```ts
ProfileEntry = { name: string; provider: string; apiKey?: string }
ValidationContext = {
  nameDenylist: ReadonlySet<string>;
  modelsJsonConflicts: ReadonlySet<string>;
  supportedSources: ReadonlySet<string>;
  oauthSources: ReadonlySet<string>;
}
```

- `readProfileConfig(path)`：读取 `provider-profiles.json`；缺文件返回 `{}`；坏 JSON、顶层非对象或读取错误抛 `ConfigError`。
- `readModelsJsonConflicts(path)`：只读 models.json，按宿主 `ModelConfig.load` 的 BOM、`//` 注释和尾逗号规则归一化。它**不**返回全部 provider 键，只返回危险同名配置的键。
- `parseEntries(raw, validation)`：无副作用；每个 JSON 自有键恰进入 `entries` 或 `errors`。

### 同名覆盖判定

对于 `models.json.providers[name]`：

| 形状 | C1 结论 | 原因 |
|---|---|---|
| 仅 `modelOverrides`，且各 override 无 `headers` | 允许 | 宿主只通过 `applyModelOverride` 改模型字段，不进入认证合成 |
| 任意 provider 级字段（含 `apiKey`、`baseUrl`、`api`、`headers`、`models`、`name`、`compat`、`oauth`、`authHeader`） | 拒绝 | 可影响认证、端点、目录、provider 行为或请求头 |
| `modelOverrides.*.headers` | 拒绝 | 宿主 `resolveConfiguredModelHeaders` 会将它加到请求 |
| models.json 不可解析 | 返回空冲突集并 warning | 宿主自身不会接受该配置；插件不尝试重建 ModelConfig 错误模型 |

### `parseEntries` 的判定顺序

1. name 正则；
2. 宿主存储保留键（`Object.getOwnPropertyNames(Object.prototype)`）；
3. 内置 provider id 同名；
4. `modelsJsonConflicts`；
5. 条目对象形状；
6. `provider ∈ supportedSources`；
7. OAuth 来源不得带 `apiKey`；
8. API-key 来源的 `apiKey` 若出现，必须是非空字符串。

每个失败项具名 `EntryError` 并 `continue`；JSON 文本重复键由 JSON 解析的后值语义处理，插件不另造重复键 parser。

## C2 — 官方来源分类

`provider-source.ts` 只从 built runtime 允许的 `@earendil-works/pi-ai/providers/all` 导入 `builtinProviders()`。

```ts
sourceInfos(): Map<string, {
  provider: Provider;
  isOAuth: boolean;
  forwardFilterModels: boolean;
}>
```

- 逐一读取官方 factory product，缓存为只读值；C3 永不修改 base。
- `refreshModels !== undefined` 的来源排除（当前 `radius`）：其目录恢复闭包按原 id 过滤，重命名后不安全。
- `isOAuth` 来自 `provider.auth.oauth !== undefined`。
- `forwardFilterModels` 仅对 `github-copilot` 且官方 filter 存在时为真；其源码按 OAuth credential 的 `availableModelIds` 过滤模型 id，不使用 provider id。
- `builtinIds()` 仍返回所有内置 id，用于禁止实例覆盖内置注册。

**Post**：`getBase(name)` 只返回受支持来源的官方 base；未知或动态目录来源抛具名错误。支持集、`/add-login` 候选和 C1 provider 校验来自同一缓存，避免三份名单漂移。

## C3 — 命名实例构造

### `restampModels(models, name)`

**Pre**：`models` 来自未修改官方 base；name 已由 C1 验证。

**Post**：新数组等长同序；每个元素是新对象且 `provider === name`；其他字段与输入相等；嵌套 metadata 引用共享；不改输入。

### `wrapApiKeyAuth(auth, configKey)`

**Post**：保留 `name` 与 `login` 引用；resolve 顺序：

1. 宿主传入的本实例 credential key；
2. profile `apiKey`（`$VAR`/`${VAR}` 展开，缺变量为未配置；`$$`/`$!` 转义）；
3. `undefined`。

它不调用原 `envApiKeyAuth.resolve`，所以不触发官方 `ZAI_API_KEY` 一类回退；不支持 `!command`，不从配置 key 执行 shell。

### `instanceProvider(base, entry, forwardFilterModels)`

实例对象只显式构造：

| 字段 | 值 |
|---|---|
| `id` | `entry.name` |
| `name` | `` `${base.name} (${entry.name})` `` |
| `baseUrl` / `headers` | 官方 base 引用 |
| `auth` | API-key handler 包装；OAuth auth 原样保留 |
| `getModels` | 每次读取 base 目录后重戳 |
| `stream` / `streamSimple` | 官方函数引用 |
| `filterModels` | 仅 `forwardFilterModels && base.filterModels` 时，以委托 wrapper 转发 |

`refreshModels`、deferred handlers、任意未列字段一律不进入实例。由于 C2 只会对经过源级核验的 Copilot 设置 `forwardFilterModels`，任意测试探针或未来未知 filter 不会被盲目复制。

### 同名 models.json 的最终合成

C3 返回 native Provider 后，宿主仍以它为 base 执行 `composeModelProvider`：安全 `modelOverrides` 有意叠加到 `getModels()`；C1 已阻断任何会进入 `composeApiKeyAuth`、provider 路由或 `resolveConfiguredModelHeaders` 的同名字段。因此“基础实例白名单”与“最终模型覆盖”是两个不同层级的合同，不能混写成全字段恒等。

## C4 — 注册与同步错误收集

`registerInstances(pi, items)` 对每项同步调用 `pi.registerProvider(provider)`：同步成功记入 `registered`，同步抛错记入具名 `failed`，继续下一项。

**边界**：加载期的真实注册可能先入宿主队列、后提交；插件的同步 `registered` 不是提交事务凭证。宿主 pending 队列的提交失败行为是 R-C4，未由本插件证明。

## C5 — `/add-login` 与 profile 写入

### 命令语义

```text
/add-login <name> <provider> [apiKey]
```

- `help`、`h`、`?`、`-h`、`--help` 与裸调用显示帮助；仅 `help` 是 Tab 首位候选，其他拼写可手输。
- 不可识别 provider 立即 declined；OAuth 来源带 apiKey 立即拒绝。
- 已存在的 profile name 拒绝，不做静默覆盖。
- 写入前读取当前 profile、models.json 冲突集和 C2 分类，合并后重跑 C1；只对本次 name 的错误拒写，既有坏条目遵循加载期容忍语义。
- 成功写入后立即以同一 C2/C3 路径注册；注册后才失败时，文件已保存，提示重启后生效。

### Tab 的位置状态

`getArgumentCompletions` 返回的 `value` 替换**整个参数区**，因此候选必须包含已输入 name：

| 状态 | 参数文本 | 候选 |
|---|---|---|
| A | 仅空白 | 单个 `help` |
| B | 首 token 是 `help` 前缀 | `help` |
| B' | 首 token 为 name（有无尾随空格） | `<name> <fuzzy provider>` |
| C | name + provider 前缀 | `<name> <fuzzy provider>` |
| D | apiKey 位 | null |

provider 搜索复用 `@earendil-works/pi-tui` 的 `fuzzyFilter`，所以 `codex` 能命中 `openai-codex`。命令名刚补全后紧邻 Tab 的无响应是宿主 autocomplete 生命周期行为，内置 `/login` 同样存在，不由 C5 伪造补救。

### 写入边界

`upsertProfileEntry` 在同一目录写临时文件再 rename。单进程写入具备该步骤的替换语义；跨 Pi 会话没有锁，最后 rename 获胜，属于显式并发边界。`/rm-login` 有意不实现：删除条目、清凭据、清理已注册实例是三种不同状态转换，help 只给人工删除顺序。

## I 文件映射

```text
index.ts                         re-export extension factory
provider-profiles-extension.ts   C1→C4 编排、注册 C5
config-loader.ts                 profile 与 models.json 冲突读取
config-entry.ts                  ValidationContext / 纯校验
provider-source.ts               工厂分类与支持集
instantiator.ts                  认证包装、目录重戳、受控 filter 转发
registrar.ts                     同步注册错误收集
config-writer.ts                 原子 profile 写入
commands.ts                      /add-login 与补全状态机
test/*.test.ts                   当前实现证据
```
