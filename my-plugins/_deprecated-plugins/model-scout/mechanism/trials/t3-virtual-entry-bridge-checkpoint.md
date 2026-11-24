# T3 检查点 — 虚拟入口(原profile id) + 插件独立桥接物理 provider

状态：**机制可行性检查点，未运行 demo**（按本轮合同：先判不可跨越障碍；存在未闭合关口时不硬搭 demo）。
范围：只读源码论证。未跑 T1/T2，未动真实配置/凭据，未启动真实会话。
基线版本：本仓 `packages/coding-agent/src`（安装版同源）。

## 结论

组合**未被排除，也未被证实**。接口层四问中有三问获得源码支持；存在 1 个疑似阻塞级关口（桥接凭据门）与 1 个时序关口未闭合。Oracle 的"虚拟模型必须路由到注册的物理模型"不构成排除：路由目标可以是插件自注册的 native provider——但该目标必须通过 `hasConfiguredAuth` 门，这正是未闭合点。

## 一、接口实际支持（file:line 已核）

1. **注册即目录可见（无需网络）** `model-runtime.ts:1001-1019`
   `registerVirtualModel` 同步走 `updateModelSnapshot()`（1018），`getModel(profileId,"glm-5.4")` 立即返回虚拟条目；随后仅 `void this.refresh({ allowNetwork: false })`（1020），无网络、无递归。
2. **先官方后虚拟不可注册 → 免费的接管检测器** `model-runtime.ts:1004-1007`
   同 provider/id 已存在物理模型时 `registerVirtualModel` 抛 `conflicts with a physical model`；也可用 `getPhysicalModel`（1074-1078）直接探测。
3. **虚拟隐藏同 id 物理模型 → 官方接管必须主动撤出** `virtual-models.ts:217-218,224`
   `withVirtualModels` 的 `physical()` 过滤掉与虚拟同 id 的 chat 物理模型。官方 refresh 加入 glm-5.4 后，只要虚拟仍注册，官方条目**不可见**——接管不是自动的，必须 `unregisterVirtualModel`。
4. **撤出不递归、不覆盖原生** `model-runtime.ts:1022-1030`
   删除后 `recomposeProvider` 还原；仅 `refresh({allowNetwork:false})`。`registerNativeProvider` 同样只 `allowNetwork:false`（939）。T1 已运行证明该路径不创建 `models-store.json`（wrapper 场景；bridge 走同一 refresh 入口，源码级同路径）。
5. **原 profile 注册不被替换** `model-runtime.ts:307-315, 532`
   `composeProvider` 在无 config/extension overlay 时原样返回 base；`getRegisteredNativeProvider` 读 `nativeExtensionProviders` 原对象——虚拟注册期间原 native 引用不变。`virtual-models.ts:219-235` 展开保留 `auth/stream/streamSimple/baseUrl/name/headers` 引用。
6. **原目录/凭据过滤与 hooks 语义（物理侧）** `virtual-models.ts:227-232`
   `filterModels/filterAllModels` 先对物理列表调用**原 provider 的原过滤函数**，虚拟无条件追加其后；物理 `stream/streamSimple` 原样透传（233-235）。provider 永远收不到虚拟模型（`virtual-models.ts:5`）。
7. **禁用残留面**：注册均在内存 map（`nativeExtensionProviders`/`virtualModels`），扩展禁用即无注册；插件私有缓存文件无消费者。源码级成立；bridge 场景未运行验证。

## 二、源码推导（未运行证实）

- **桥接鉴权必须自行解析**：`model-runtime.ts:763-765` — 路由目标 provider ≠ 虚拟 provider 时，`{apiKey,headers,env}` 覆盖**不转发**（传 `{}`）。桥接的 `provider.auth` 必须在运行时委托原 profile native（`getRegisteredNativeProvider`）解析，transport 直接复用原 `stream/streamSimple`，`model.id` 保持 glm-5.4。stream 路径 685 只查桥接自身 resolution 结果。
- **会话语义差异（须向用户披露）**：assistant message 记 `provider=桥接id, model=glm-5.4`（非原 profile id）；`model_change` 记虚拟选择；resume/回退语义文档已定义（`virtual-models.ts:128-145`）。

## 三、未闭合（阻塞级，本轮预算内未能关闭）

1. **桥接凭据门** `model-runtime.ts:1069` + `552-554` + `946-964`
   `resolveModel` 要求路由目标 `hasConfiguredAuth(bridge)`（∈ `snapshot.configuredProviders`）。`registerNativeProvider → markProvisionallyConfigured`（953-954）在**无存储凭据且无配置 key** 时早退——插件不能替用户写凭据/配置（Q4）。唯一候选通路是异步 availability pass（`refreshProviderAvailability`，389-427）能否仅凭 bridge 自身 `auth` 实现把它标记 configured：**未读，未证**。
2. **首次解析时序**：CLI `--model`/默认模型/会话恢复的首次解析是否晚于扩展注册，未验证。`markProvisionallyConfigured` 注释自证竞态存在（"initial model selection read the snapshot before they finish"）。
3. **接管撤出钩子**：扩展在"每次 refresh 缓存阶段"可收到的事件面（runner.ts 事件列表）未查，撤出触发点未定。

## 四、最小失败路径（若关口1不可过）

load → `registerNativeProvider(bridge)` 于 953 早退 → bridge ∉ configuredProviders → `registerVirtualModel(profile/glm-5.4)` 成功且目录可见（1018）→ 用户选择该模型 → `resolveModel` 路由返回 bridge/glm-5.4 → **1069 抛 `routed to …/glm-5.4, which has no credentials`** → 该请求以 error response 结束。原物理模型不受影响（仍走未被触碰的原 provider、原过滤、原 transport）——失败不污染官方路径，但虚拟入口不可用，合同 Q5"可选意味着可用"不成立。

## 五、下一轮最小动作（按序）

1. 读 `model-runtime.ts:389-427`（`refreshProviderAvailability`）+ `AuthCheck` 形状，判定关口1；
2. 读 CLI 启动 `--model` 解析次序 vs `bindExtensions`，判定关口2；
3. 读 runner.ts 模型刷新事件面，定撤出触发；
4. 若 1-3 全过：用 `lib/trial-env.mjs` 临时 agentdir + faux transport 写硬超时 t3 试验，只验证：profile id 首次解析、原生官方 model 引用不变、桥接真实线上 id+原鉴权/transport 转发、官方同 id 接管（register 抛错→unregister→官方可见）。
