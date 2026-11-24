# model-scout 架构文档

> 前置：`docs/research.md`（调研，机制依据均含代码引用）。
> 本文档对应 workflow §4.2；经确认后进入细化阶段（§4.3）。

## 0. 已确认需求（用户原话，规范来源）

- R1 仅补充官方未支持的模型；
- R2 官方后来支持了，就去掉发掘的（收敛）；
- R3 全自动无感：不手动处理，像官方原生支持一样；每次 model refresh 时插件那部分
  发掘已经完成；
- R4 缓存优先返回，后台过一阵自动更新（stale-while-revalidate）。

## 1. 核心流程

```
session_start / turn_start
   │ scheduler.check()（纯本地：读 state.json 的 fetchedAt，fresh → 结束）
   │ stale → 立即返回（不阻塞），后台 job 启动 ──────────────┐
   ▼                                                        ▼
用户继续正常使用                                   background job：
pi 每次 refresh（/model 打开、启动、                1. 拉 models.dev（conditional GET，
   4h 窗口）自动合并 models.json                      etag/304，更新本地快照）
   ⇒ 插件条目天然在列（R3 的关键）                  2. official = getBuiltinModels()
                                                       ∪ models-store.json 各 provider 条目
                                                    3. per 关注 provider：
                                                       候选 = models.dev 该 provider 条目
                                                       （relay 无收录 → 原生 /models + key，
                                                        元数据按 canonical ID 匹配 models.dev）
                                                    4. toAdd   = 候选 − (official ∪ 现有 models.json IDs)
                                                       toPrune = 插件登记条目 ∩ official
                                                    5. 有变更 → 合并写 models.json（原子+备份）
                                                       + 更新登记 → registry.refresh() → 轻 notify
```

R3 成立的机制根据：插件条目持久在 `~/.pi/agent/models.json`，pi 的每次模型 refresh
（`ModelRuntime.refresh` 重读 models.json）自动包含它们；插件不需要精确挂钩 refresh 事件
（事件层无此钩子，types.ts:1640-1712 已核），只需以与官方同数量级的 4h SWR 窗口保持
models.json 中自己管理的集合新鲜。

## 2. 核心数据结构

```
数据结构：ManagedEntry（sidecar 登记项）
字段：
  - addedAt: number — 写入时间戳
  - source: "models-dev" | "native-endpoint" — 发现来源
跨模块共享性：reconcile 写入判定依据；models-json-store 写/删时登记/注销；
  --clean/--prune 的操作范围定义。

数据结构：ScoutState（~/.pi/agent/model-scout/state.json）
字段：
  - managed: Record<providerId, Record<modelId, ManagedEntry>>
  - cache: { fetchedAt: number; etag?: string }（models.dev 快照元数据）
类型不变量：
  - managed 中的 (provider, model) ⇔ models.json 中由本插件写入且未被清理的条目
生命周期：随每次成功落盘同步更新；--clean 清空。

数据结构：RawSnapshot（~/.pi/agent/model-scout/models-dev.json）
字段：models.dev api.json 原文 + fetchedAt/etag 头信息（由 state.cache 引用其元数据）。
```

插件配置 `config.json`：watched providers（默认 = models.json 现有 providers ∪ 已配置
auth 的内置 provider）、`ttlMs`（默认 4h）、`enabled`。

## 3. 模块划分与功能规约

模块均位于 `my-plugins/model-scout/src/`，入口 `index.ts`。

### 3.1 index.ts（组装）
- 功能：factory `(pi: ExtensionAPI) => void`；注册 `/model-scan` 命令
  （子命令 `status` / `--prune` / `--clean`，手动触发用）；订阅 `session_start`、
  `turn_start`（调 scheduler.check）；`session_shutdown` 清理定时器（I5）。
- Requires：pi 扩展运行时。
- Ensures：会话存活期间 scheduler 处于可触发状态；进程退出无挂起句柄。

### 3.2 scheduler.ts（SWR 节流，R4 核心）
- 功能：`check()` 纯本地判定缓存新鲜度；stale 时启动（且仅启动一个）后台 job。
- Requires：state.json 可读（首次运行视为 stale）。
- Ensures：check() 同步路径只做本地文件读取（I4）；同一时刻至多一个在途 job；
  job 完成或失败后 state.cache.fetchedAt 更新或保持（失败不推进 fetchedAt）。
- Invariants：后台 job 与同步路径无共享可变内存状态，通信仅经文件。

### 3.3 sources/models-dev.ts
- 功能：拉取/条件请求 models.dev api.json，维护 RawSnapshot；`modelsFor(providerId)`
  从快照取该 provider 的模型条目。
- Requires：网络可达（不可达时抛错，调用方按失败处理）。
- Ensures：5MB 响应只在后台 job 中处理；快照写入原子。

### 3.4 sources/native-endpoint.ts
- 功能：对 models.dev 未收录的 provider，用 `ctx.modelRegistry.getProviderAuth(provider)`
  取 baseUrl/apiKey，`GET <baseUrl>/models` 取可见模型 ID 列表。
- Ensures：请求带超时与 AbortSignal；凭证不出现在日志（安全约束）。
- 边界：失败（401/超时）→ 该 provider 本轮跳过，不删既有条目。

### 3.5 official-layer.ts（R1/R2 判定基准）
- 功能：计算"官方已有"集合 = `getBuiltinModels()`（import `@earendil-works/pi-ai/providers/all`，
  loader 别名重定向，pi-cc 先例）∪ `~/.pi/agent/models-store.json` 各 provider 的
  overlay `models[].id`。
- Ensures：**不读 registry.getAvailable()**——它含 models.json 用户层，会把插件条目
  误判为官方，破坏 R2 收敛判定（D3）。
- 边界：models-store.json 读失败 → 按 overlay 为空处理；后果仅为收敛/去重延迟，
  不产生误删（prune 只在官方确证时执行）。

### 3.6 metadata-map.ts
- 功能：models.dev 模型条目 → pi `ProviderModelConfig` 字段映射（映射表见 research.md §3）；
  relay 裸 ID → models.dev `canonical_model_id` 匹配补元数据；匹配失败 →
  最小条目（仅 id，缺省 contextWindow 128000），并在 state 标记 `metadata: "sparse"`。
- Ensures：cost 四字段要么齐写要么整体省略（pi schema 要求）。

### 3.7 models-json-store.ts（唯一写入路径）
- 功能：读 `~/.pi/agent/models.json`；按 reconcile 结果增/删 managed 条目；
  temp+rename 原子写；写前备份 `models.json.bak-model-scout-<date>`；
  同步维护 sidecar 登记。
- Requires：models.json 当前合法 JSON（损坏 → 本轮放弃 + notify 报错，不写）。
- Ensures：
  - 只增删 `state.managed` 登记过的条目，用户手工条目永不被动（I1）；
  - 原子替换，任何时刻磁盘上是完整合法文件（I2）；
  - 写成功后调用 `ctx.modelRegistry.refresh()` 使变更即时生效。

### 3.8 reconcile.ts（R1/R2 核心）
- 功能：`compute(input) → { toAdd, toPrune }`，纯函数。
  - toAdd = 候选 − official − models.json 现有全部 ID（含用户手工，避免重复）
  - toPrune = managed ∩ official
- Ensures：结果单调——official 已有的 ID 绝不出现在 toAdd（I3）；非 managed 的
  models.json 条目绝不出现在 toPrune（I1）。

### 3.9 ui.ts
- 功能：变更落盘后的轻量 `ctx.ui.notify`（发现 N 个 / 收敛 N 个）；`/model-scan`
  的 status/prune/clean 输出。无确认交互（R3 全自动）。

## 4. 接口规约（模块间）

```
接口：index/scheduler → sources + official-layer + reconcile + models-json-store（后台 job 内）
输入：ScoutState（cache 元数据）、config（watched/ttl）
输出：写盘动作（models.json、state.json、快照）+ registry.refresh() + notify
协议约定：
  - 调用方（job）保证串行（scheduler 单飞）；
  - sources 失败 → 对应 provider 本轮跳过，异常不上抛出 job（记入 state.lastError）；
  - models-json-store 是唯一写 models.json 的模块（单一写入点）。

接口：/model-scan 命令 → scheduler（强制 stale）/ models-json-store（--clean 直接清理）
协议约定：--clean 只删 managed 条目并清空登记，恢复插件介入前状态。
```

## 5. 关键设计决策及理由

- **D1 持久层 = models.json 条目，不用 `registerProvider`+`refreshModels`**：
  R3 要求"像官方原生"——models.json 条目被 pi 每次 refresh 自动合并、重启即在、
  用户可见可改；registerProvider 同名注册替换整个内置 provider（须手工搬运内置目录，
  pi-cc/provider-profiles 的重戳模式），persist 槽位又与 pi.dev 官方 overlay 同文件互扰。
  代价：无官方写 API，用 node:fs 直写（有 provider-profiles/config-writer.ts 先例；
  格式有公开 JSON schema；原子写+备份+单一写入点缓解）。
- **D2 触发 = session_start + turn_start 搭车 + 4h SWR，不追求精确挂钩 refresh**：
  事件层无 refresh 钩子（已核）；条目持久使刷新对齐无必要——官方每次 refresh 自然
  包含插件部分，插件自持 4h 窗口与官方同数量级即可。turn 搭车为 O(1) 本地读（I4）。
- **D3 官方判定用 builtin ∪ models-store 文件，不用 registry.getAvailable()**：见 3.5。
- **D4 relay provider 走原生 /models + canonical 匹配**：models.dev 无 yunwu 类私有
  中转站条目；其中转的模型 ID 基本等于上游官方名，可借 `canonical_model_id` 补全元数据。
- **D5 全自动写用户配置的风险控制**：备份链、只动 managed、`--clean` 全清、`--status`
  审计。用户已选定全自动（R3），风险以可回滚性兜底而非交互确认。

## 6. 架构正确性论证

goal → 模块映射：
- R1「仅补官方缺口」→ official-layer（官方集合）+ reconcile.toAdd（差集）
- R2「官方补上即收敛」→ reconcile.toPrune（managed ∩ official）+ models-json-store 删除路径
- R3「全自动无感」→ index（factory 自动挂载）+ scheduler（无人工触发）+
  models-json-store 持久条目 + registry.refresh()；无 UI 门槛（ui 仅信息性 notify）
- R4「缓存优先、后台更新」→ scheduler（cache-first 同步判定）+
  sources/models-dev（后台 conditional GET）

模块协作论证：
R3 要求"用户打开 /model 时新模型已在列"。拆两半：(a) 已写入的条目总在列——
models.json 是 pi 每次 refresh 的固定输入层（research §2.1），不依赖插件存活；
(b) 新模型及时写入——scheduler 在 session_start/turn 以 4h 窗口触发后台 job，
job 由 sources 提供候选、official-layer 提供基准、reconcile 产出变更、
models-json-store 原子落盘并 refresh。(a)∧(b) ⇒ 每次可感知的模型选择时刻，
插件部分已合并。R4 由 scheduler 的同步路径（本地读 fetchedAt）与后台 job 分离保证：
同步路径零网络零等待（I4），新鲜度窗口与官方刷新窗口（4h）一致，用户可感知的
滞后上界 = 一次窗口 + 一次 job 时长。R1/R2 为 reconcile 纯函数的两条差集规则，
official 集合的单调增长 ⇒ toAdd 单调缩减、toPrune 单调增长（I3，收敛性）。

关键假设：
- H1 models.dev api.json 字段格式稳定（已核样本，zhipuai 17 条）。
- H2 models.json / models-store.json 格式稳定（公开 schema / pi 自有格式）。
- H3 插件可 import `@earendil-works/pi-ai/providers/all` 的 `getBuiltinModels()`
  （loader 别名重定向，pi-cc 在用）。
- H4 turn_start 频率足以在 4h 窗口边界后首个用户交互即触发后台更新。
- H5 同机多 pi 会话并发写 models.dev 快照/models.json：temp+rename 保证文件不损坏；
  last-writer-wins 可能丢一轮合并，但下轮 SWR 自愈（可接受，见 §7 边界 4）。

模块级 invariant 列表：
- I1 用户手工条目不被增删：唯一写入点 models-json-store 仅操作 managed 集合。
  维护方：models-json-store 写入 / reconcile 产出范围。
- I2 models.json 任何时刻磁盘完整：temp+rename 原子替换，写前备份。
- I3 收敛单调性：diff 基准含 official ⇒ official 已有 ID 永不进 toAdd。
- I4 同步路径零网络：scheduler.check 只读本地文件。
- I5 无挂起句柄：定时器 `.unref()`，session_shutdown 清理（my-plugins/CONVENTIONS.md G1）。
  preservation：所有后台 job 持 AbortSignal，shutdown 时取消。

## 7. 边界与已知风险（进入细化阶段需逐项落实错误分支）

1. models.dev 数据错误（context/pricing 偏差）→ 用户可手改 models.json；插件下轮
   SWR 不回改用户手改（非 managed 的同 ID 条目不再被管理）。
2. relay 元数据匹配失败 → 最小条目 + `metadata: "sparse"` 标记（`/model-scan status`
   可见），不阻塞加入。
3. 官方层判定漏报（models-store 读失败/格式变化）→ toPrune 少删（无害）、toAdd
   可能重复添加官方已有（add-or-replace 覆盖为 models.dev 元数据，等价无害）。
4. 多会话并发写 → 文件不损坏；丢一轮合并自愈。
5. 智谱免费模型不在原生 /models → relay 路径下该类模型发现不了（models.dev 主路径
   不受影响）；不做激进探测。
6. api.json 5MB → 仅后台处理，快照落盘后按 provider 取子集，同步路径不触碰。
