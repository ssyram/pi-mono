# model-scout 调研报告（纯插件：自动发现各 provider 新模型并自动配置）

> 状态：调研阶段产物，待用户确认后进入架构阶段。
> 插件名 `model-scout` 为暂定名。运行环境：已安装 pi 1.6.0（已核验含全部所需 API）。

## 1. 问题

只跟随 pi 官方 catalog 更新太慢：新模型（如 glm-5.4）在 provider 官网已可用，但要等
pi 维护者更新 pi.dev 远程目录后才进本地。目标：纯插件（不改 pi 核心代码）自动发现
provider 新模型并完成配置，让新模型尽快可在 `/model` 中选用。

## 2. pi 现有模型供给链路（代码结论）

### 2.1 模型从哪来（四层）

1. **内置 catalog**：`packages/ai/catalog/` → `models.generated.ts`，随 pi 版本发布。
2. **pi.dev 远程目录 overlay**（官方"慢路径"，即用户抱怨的对象）：
   `packages/coding-agent/src/core/remote-catalog-provider.ts`
   - `GET https://pi.dev/api/models/providers/<providerId>?types=chat,image,classifier`
   - 4 小时节流 + etag/304；成功后写入 `~/.pi/agent/models-store.json`（`FileModelsStore`，
     `src/core/models-store.ts`，注释 "Locked JSON-backed storage for dynamically refreshed provider catalogs"）
   - `pi update --models` 可强制刷新；只有 `radius` 一个内置 provider 原生实现 `refreshModels`
3. **用户配置 `~/.pi/agent/models.json`**（官方文档化的用户层，`docs/models.md` + `docs/models-configuration.md`）：
   - `providers.<id>`：内置 ID = 修改该 provider；非内置 ID = 新增 provider（需 `baseUrl` + `api`）
   - `providers.<id>.models[]`：**add-or-replace 语义**（同 provider+ID 替换，否则新增，不动其他模型）
   - `modelOverrides`：只改内置/扩展模型元数据，unknown ID 忽略
   - 模型条目最小只需 `id`；`contextWindow` 默认 128000、`maxTokens` 默认 16384；
     `cost` 若写则 input/output/cacheRead/cacheWrite 四项必填（USD/Mtok）
   - `apiKey` 支持 `$ENV` / `${ENV}` / `!command`，多个 provider 可共享一个 key
4. **扩展注册**：`pi.registerProvider(name, config)`（`src/core/extensions/types.ts:1908`）
   - `ProviderConfig.refreshModels(context)` 是官方指定的"动态发现模型"路径：
     返回 `ProviderModelConfig[]` 同步生效；`context.publish({persist})` 持久化到 models-store
   - 同名注册覆盖内置 provider；`models` 数组提供则**替换**该 provider 全部模型（须先取内置再合并）
   - 注册本身不持久化（每次启动经 factory 重建，异步 factory 会被 await）

### 2.2 热加载与扩展能力（全部已核验存在于 1.6.0）

| 能力 | 入口 | 依据 |
|---|---|---|
| 重载 models.json | `ctx.modelRegistry.refresh()` | `model-registry.ts:56` 注释 "Reload models.json"；llama 内置扩展即如此调用 |
| 读可用模型 | `ctx.modelRegistry.getAvailable()/find(provider, id)` | `model-registry.ts:68/72` |
| 读 provider 凭证 | `await ctx.modelRegistry.getProviderAuth(providerId)` → `{auth:{baseUrl,apiKey},env}` | llama 扩展用法 |
| slash 命令 | `pi.registerCommand(name, {description, getArgumentCompletions?, handler})` | types.ts:1726 |
| 事件 | `pi.on("session_start"|"turn_end"|"session_shutdown"|...)` | types.ts:1643-1710 |
| HTTP | 全局 `fetch`，无沙箱（扩展=pi 进程内可信代码） | extensions.md:7 |
| 文件 | `node:fs/promises` 直接可用 | provider-profiles/config-writer.ts 先例（tempfile+rename 原子写） |
| 定时 | `setInterval`（须 `.unref()` + `session_shutdown` 清理，否则 `pi -p` 挂死） | my-plugins/CONVENTIONS.md G1 |
| UI | `ctx.ui.notify/confirm/select`；`pi.setModel(model)` 只切当前会话 | types.ts:1840 |

my-plugins 先例：`provider-profiles`（读写用户目录 JSON + provider 实例化）、
`pi-cc`（完整自定义 provider）、`throttle-zai`（带 refreshModels 的 provider 骨架）、
`provider-usage`（modelRegistry 读取 + 命令 + 补全）。

## 3. 外部发现源（三层，均已实测/检索确认）

| 源 | 认证 | 元数据 | 备注 |
|---|---|---|---|
| **models.dev** `GET https://models.dev/api.json` | 免 key | **最全**：326 providers；每模型 `limit.context/output`、`cost.{input,output,cache_read,cache_write}`（USD/Mtok）、`reasoning`、`tool_call`、`attachment`、`modalities.input/output`、`release_date`、`deprecation`、`canonical_model_id`；每 provider 带 `api`(baseUrl)/`env`(变量名)/`doc` | 社区维护（opencode 内部同用）；智谱 17 个模型条目；5MB 单文件 |
| **OpenRouter** `GET https://openrouter.ai/api/v1/models` | 免 key 可用 | `context_length`、`pricing.{prompt,completion}` per-token、modalities、`created` | 430+ 模型；仅覆盖 OpenRouter 可路由模型 |
| **provider 原生** `GET <baseUrl>/models`（OpenAI 兼容） | 需 key | 通常仅 `id/created/owned_by`（OpenAI 标准如此） | 证明"该 key 真的可用"；**智谱列不出免费模型**（实测，免费 ID 只能从文档翻） |

### 字段映射（models.dev → pi models.json，一一对应）

| models.dev | pi models.json |
|---|---|
| `id` / `name` | `id` / `name` |
| `limit.context` | `contextWindow` |
| `limit.output` | `maxTokens` |
| `cost.input/output/cache_read/cache_write` | `cost.{input,output,cacheRead,cacheWrite}`（单位一致 USD/Mtok） |
| `reasoning` | `reasoning` |
| `modalities.input` 含 `image` | `input: ["text","image"]` |
| `tool_call` | 无需映射（pi 默认按 API 支持工具） |
| `thinkingLevelMap`、`compat` | 无来源，省略（compat 多数字段 pi 按 baseUrl 自动探测，如 thinkingFormat） |

## 4. 方案对比

### 方案 A：写 `models.json` + `ctx.modelRegistry.refresh()`（推荐）

插件发现新模型 → 合并写入 `~/.pi/agent/models.json` 对应 provider 的 `models[]` →
调 `registry.refresh()` 热加载 → `ui.notify` 告知。

- 优点：
  - 对**内置 provider（zai）与自定义 provider（yunwu 等）统一**处理；
  - 官方文档化的用户配置格式（含 JSON schema `https://pi.dev/schemas/models.schema.json`），
    用户可见、可手改、重启持久；
  - add-or-replace 语义天然支持"只加新模型不动存量"；
  - 官方 catalog 赶上后同 ID 条目被用户侧覆盖（或后续做自动清理），不冲突。
- 缺点/边界：
  - 无官方"写配置"API，需 `node:fs` 直写（有 provider-profiles 先例；缓解：写前备份
    ——用户目录已有 `models.json.bak-*` 先例，只增改自己管理的条目，提供清理命令）；
  - 格式稳定性无硬承诺（但 schema 公开，变更概率低）。

### 方案 B：`registerProvider` + `refreshModels` + `publish({persist})`

为每个目标 provider 包一层动态 provider，官方指定的动态发现路径。

- 优点：无旁路；`persist` 自动落 models-store。
- 缺点：
  - 同名注册**替换整个 provider**，须手动取内置目录再合并（pi-cc/provider-profiles 的重戳模式）；
  - persist 写 models-store 条目与 pi.dev 官方 overlay 同槽位，恢复逻辑（仅当
    `lastModified > localGeneratedAt` 采用 overlay）相互影响，行为待深核；
  - 注册不持久化，每次启动重建；对内置+自定义混合 provider 集合要各写一套包装。
- 结论：复杂度显著更高，收益不明显。**不推荐**为主路径。

### 方案 C（推荐组合）：A 为骨架 + models.dev 为主发现源 + 原生 /models 为可选验证

- 主发现源 models.dev（元数据全、免 key、含 release_date 可做"新模型"判定）；
- 可选验证：`getProviderAuth` 拿 key → 调 provider 原生 `/models` 标记"该 key 已可见"
  （验证失败不删条目——智谱免费模型列不出的坑）。

## 5. 触发与流程（设计输入）

- 手动命令（拟 `/model-scan`）：即时扫描 → diff（models.json 已有 vs models.dev 最新，
  以 `release_date`/新 ID 判定）→ 展示新模型清单（名称/context/pricing/能力）→ 加入 → refresh → notify。
- 自动扫描（可选）：`session_start` 后台节流检查（4h，与官方一致），发现新模型仅 notify 提示，
  不自动写（或按用户选择）。
- 关注列表：默认 = models.json 中出现的 provider + `getProviderAuth` 已配置的内置 provider；
  可在插件配置中增删。

## 6. 风险与边界

1. models.dev 社区数据可能滞后或出错（context/pricing 偏差）——用户可在 models.json 手改；
2. ID 出现 ≠ 该 key 可用（尤其新模型灰度期、智谱免费模型不在 /models）——验证步骤保守处理；
3. 对内置 provider 写入条目后，官方 overlay 同 ID 模型被用户条目覆盖——语义可接受，后续可做
   "官方已有则清理插件条目"的收敛功能；
4. models.json 并发写（用户编辑 vs 插件写入）——tempfile+rename 原子写 + 备份缓解；
5. 5MB 的 api.json 全量拉取——需节流与本地缓存（按 provider 只取所需子集）。

## 7. 待用户决策（进入架构阶段前）

1. **加入方式**：自动加入 / 展示后确认加入（推荐）/ 仅报告；
2. **发现源**：models.dev 为主（推荐）还是 provider 原生为主；
3. **自动扫描**：仅手动命令 / session_start 节流自动 + 手动（推荐）；
4. **插件名**：`model-scout`（暂定）。
