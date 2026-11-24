# official-catalog Hoare/QPDI-SCCO 一次实现合同对照（oracle，GLM5.3:max）

判定：**PARTIAL**（产品源码全路径论证完成；Fuzz/Docker/真实终端/宿主版本对齐未闭合，不满足 PROVEN 条件）。未发现 High/Blocker 级合同违反；3 个 Low 级偏差 + 若干 Info 观察。本文件是分析素材，不是认证；failure-paths.md 归档归主会话。

## 0. 结论速览

- 源码侧（Q→P→函数）：设计 D1–D10、R、固定验收 1–10 的代码义务在所读全部路径上成立，含并发 owner/generation/abort/publish/文件提交路径。原 auth/transport/filter 未改（git：`instantiator.ts`/`provider-source.ts` 不在修改列表，`commands.ts`/`provider-profiles-extension.ts` 仅新增接线）[source: git status + 通读]。
- 真实问题清单（按严重度）：
  - F1(Low) dispose 不粘滞：`dispose()` 后再次 `compose()` 会创建 `disposed:false` 的新 runtime，晚到 `/add-login` 理论上可在 shutdown 后启动网络 job。可达性低（命令处理在 shutdown 后不再运行），违反 D9"关闭失效"的精神而非字面。修复：owner 闭包加 `closed` 标志，`compose` 早退 original。
  - F2(Low) 重复 `dispose()` 非严格 no-op：再次调用仍 `generation += 1`（无观察效应，D9 字面"重复调用no-op"偏差）。修复：`if (runtime.disposed) continue`。
  - F3(Low/edge) `readBoundedBody` 无 reader 回退路径先 `response.text()` 全量缓冲后才检查 16MiB 上界（catalog-fetch.ts:23-28），与 robustness §4"不能先无界再声称有界"字面冲突。实际不可达性论证：undici 对 200 响应恒提供 ReadableStream body；304 在 respond() 早退不进此函数；仅注入型 fetcher（测试）可造出该路径。修复：reader 缺失时直接 `{ok:false,kind:"invalid"}` 或按 content-length 预检。
  - Info-1 `readCatalogCache` 上界比较 `raw.length`（UTF-16 码元）非字节；自产 JSON 近似 ASCII，实际无风险。
  - Info-2 `compat` 仅 isRecord 检查、未知字段透传（overlay-model.ts:85-87，注释声明 metadata as-is；与设计"compat按真实SDK类型验证"的弱化解释，SDK 类型本身是宽松 record）。
  - Info-3 overlay 为空（含"更新但 catalogNewer=false"）时不发 ETag validator，下次全量 200 重取——低效但正确。
- 未闭合（不计为源码 bug）：Fuzz A/B/C/D（另一 child，PENDING）；Docker 隔离网络（PENDING）；测试文件内容与路径映射的逐条交叉核对（本轮按文件存在性+名称映射，未逐行核对断言）；宿主版本对齐（见 §1）。

## 1. Scope 与版本

- 评审范围 [source: git status + find]：`my-plugins/provider-profiles/official-catalog/**`（11 文件，全新 untracked）、`provider-profiles-extension.ts`（M，新增 owner/compose/attach/dispose 接线）、`commands.ts`（M，新增 `catalogOwner.compose` 接线）。`discovery/`、`mechanism/` 未启用不评审但未从 scope 排除其存在。`instantiator.ts`/`provider-source.ts`/`registrar.ts` 未修改，仅作为 caller/Pre 证据读入。
- 宿主接口核实基于仓库 `node_modules/@earendil-works/pi-ai@1.5.2`、`pi-coding-agent@1.5.2` 源码 [source: package.json version 字段]。任务书称运行时 Pi 1.6.0——**版本不一致未解决**（unresolved）：VIRTUAL_MODULES 运行时供给的版本未核实。所核接口（`ModelsPublication`/`RefreshModelsContext`/`refresh`/`refreshModelsAuth`/`getBuiltinModelDataGeneratedAt`/`applyModelOverride`）若在 1.6.0 有破坏性变更，本报告相应前提需重核。
- 未读真实用户配置/凭据；未发起任何远端请求。

## 2. 合同抽取（规范先行，非从代码反推）

权威：`docs/official-catalog-sync.md`（用户批准的 A 方案）+ `docs/model-discovery/robustness-and-proof.md` §2/§4/§5/§6 + `docs/principles.md` 身份条款（Q.I.3 不静默借号、Q.I.5 不改官方源码、Q.I.7 身份层单一职责、Q.A.7 refreshModels 闭包排除、Q.A.8 modelOverrides 宿主最上层）。

关键 Pre/Post/Inv（编号供下表引用）：
- PRE-C：caller（factory/`/add-login`）传入的 `original` 是 `instanceProvider` 产物：`id=entry.name`、无 `refreshModels`（来源集已排除 carrier）、auth 按需包装、transport 字段与 base 共享引用 [source: instantiator.ts:101-119 + provider-source.ts:30-43]。
- INV-1 原身份/transport 不变：wrap 只覆盖 `getModels`/`refreshModels`/`refreshModelsAuth`，其余字段 `...original` 浅拷贝共享引用。
- INV-2 原模型不丢：merge 先写 base 再写 overlay，仅同 `type\0id` 覆盖。
- INV-3 旧 job 不发布：job 内每个 await 后 `stale()` 检查；dispose 先置 disposed/bump generation 再 abort。
- INV-4 私有残留隔离：只写 `agentDir/provider-profiles/official-catalog/<sourceId>.json`；`publish({update})` 不带 `persist`（宿主注释："Omit to leave storage unchanged" [source: pi-ai models.ts:76-80]）。
- INV-5 无凭据外发：fetch 头仅 `accept` + 条件 `if-none-match`。
- INV-6 无 unhandled rejection：job `.catch`、notify 内 catch、stderr try/catch。
- INV-7 重启恢复：注册前 await 本地 cache 读取。
- INV-8 警告按 source+分类去重，成功 `resolve(prefix)` 清除。
- INV-9 cache-only 不建 job、不递归网络。
- POST-D6 装配异常→返回 original（实例仍注册）；POST-D7 失败不改 lastGood（overlay 不变），仅改 retryAt。

## 3. 逐函数全路径表

锚点=文件:行（official-catalog/ 简写 oc/）。

### D1 oc/catalog-source.ts
- `officialCatalogUrl`:17 — pre: 任意 string；post: 固定 `https://pi.dev/api/models/providers/<enc>?types=chat`，纯函数无副作用；无其它退出。✓"按 sourceId 固定生成"。
- `catalogCachePath`:23 — pre: agentDir+sourceId；post: join 路径，无副作用。✓
- `verifiedEndpoint`:27-31 — 路径1 `original.baseUrl !== undefined` → 返回之；路径2 无 baseUrl → catalog 中 baseUrl 去重后恰 1 个 → 返回；路径3 ≥2 个不同 → undefined。均无副作用。✓
- `resolveCatalogSource`:33-41 — 路径1 sourceId 不在 supportedSourceIds → undefined 无副作用（不进任何 IO）；路径2 `getModels()` 空 → undefined；路径3 endpoint undefined → undefined；路径4 成功 → `{sourceId, catalogUrl, endpoint, apiSet}`。副作用：仅 `supportedSourceIds()` 惰性构建进程级只读 cache（provider-source.ts:30-43，工厂产物不变异）。Pre `original.getModels` 存在：由 PRE-C 成立。✓D1"无端点替换"（endpoint 只读不写回）。反例尝试：动态闭包来源（radius）带 refreshModels → `sourceInfos` 跳过 → 路径1 拒绝 ✓（Q.A.7 承接）。

### D2 oc/catalog-cache.ts `readCatalogCache`:42-86
路径：P1 readFile 抛 ENOENT → miss("missing")（正常，不警告，D2✓）；P2 其它读错误 → miss("unreadable")；P3 `raw.length > 16MiB` → miss("invalid")（Info-1：码元非字节）；P4 JSON.parse 抛 → miss("invalid")；P5 非对象/null → invalid；P6 version≠1 → invalid；P7 sourceId≠ → mismatch；P8 baseUrl≠source.endpoint → mismatch（端点变更拒收 ✓）；P9 apiSet 集合不等（`sameStringSet`:22-27 含重复检测，长度先判）→ mismatch；P10 checkedAt/retryAt 非有限数 → invalid；P11 etag 非串 / P12 lastModified 非数 → invalid；P13 `validModels`:29-38 任一条目 `readOverlayModel` 失败 → 整体 invalid（与 parseCatalog 数组形态的"逐条丢弃"不同——cache 是自有信任域，逐条=写坏，整体拒 ✓ 合理分层）；P14 → hit，重建强类型 CacheV1（apiSet 规范化排序）。全部路径无 throw 跨 compose 边界 ✓（D2"miss 不抛"）。反例：mismatch 后是否永久禁用更新？否——runtime 仍创建（overlay=[]），后续 refreshModels 照常触发 job ✓"不能永久禁用更新"。

### D5 `writeCatalogCache`:101-119 + `tempName`:88 + `discard`:92-99
路径：P0 `mkdir recursive`（副作用：可能建目录，即使后续 abort——无害，INV-4 内）；P1 mkdir 后 aborted → discard temp → failed("aborted")；P2 writeFile(0600, 唯一名 `.src.pid.rand.tmp`) 抛 → catch → discard → failed("io")（旧文件未动 ✓）；P3 write 后 aborted → discard → aborted；P4 rename 抛 → discard → io（rename 跨设备抛 EXDEV 归 io，符合"尽力清理"）；P5 rename 成功 → written。并发：多进程只经 rename 观察完整快照 ✓（D5）。`discard` 自身 catch 吞——残留 temp 文件以 `.` 开头且下次写入用新随机名，reader 不读 temp 名 ✓（注释成立）。反例"aborted 但 rename 已完成"：P1/P3 检查点在 rename 前，rename 不可中断点后无副作用差异（written 结果可能被调用方丢弃但文件已是验证快照，属 INV-3"私有残留只能被本插件下次验证读取" ✓——runCatalogJob:154 stale 后返回，文件留下，重启 readCatalogCache 全量重验）。

### D7 oc/catalog-fetch.ts
- `once`:65-90 — deadline `setTimeout(timeoutMs)`+controller.abort；fetch 选项 `redirect:"error"`(3xx→throw→分类)、`keepalive:false`、头仅 accept/if-none-match（INV-5 ✓）；`AbortSignal.any([request.signal, controller.signal])`（dispose 与超时都真取消 ✓）。catch 路径：request.signal.aborted→"disposed"；controller.aborted→"timeout"；否则"network"。finally clearTimeout ✓ 无 timer 泄漏。
- `readBoundedBody`:18-51 — 主路径循环：`total += chunk.byteLength`，超 16MiB → `reader.cancel()` → invalid（逐块上界 ✓）；read 抛 → cancel → aborted?"disposed":"network"；done → TextDecoder 流式拼 text（内存 ≈ 已收块，有界 ✓）。无 reader 回退=F3（见 §0）。循环终止度量：total 单调增且阈值截断/流 done——有限 ✓。
- `parseRetryAfterMs`:53-63 — 秒数形式 cap [0,24h]；HTTP-date 形式 `Date.parse` 失败→undefined，否则 clamp。无 throw。
- `respond`:92-114 — 304→unchanged（validator 语义）；404/501→no-data（D"404/501 无可用更新" ✓）；429→failed(rate-limit,±retryAfterMs)；非 2xx→http；2xx→readBoundedBody→失败透传 kind；JSON.parse 抛→invalid（P"截断/畸形不进路径" ✓）；成功→updated{value,etag?,lastModified?}（`Date.parse(...)||undefined`：last-modified 为 "Thu, 01 Jan 1970" 得 0 → falsy → undefined——极端边界，Info 级）。
- `fetchOfficialCatalog`:116-127 — sendValidator=有 etag；304 且未发 validator → 一次无条件重取（D"304无有效body最多重取一次" ✓）；二次仍 304 → failed(http)；其余 respond(first)。反例：服务器对无条件 GET 恒回 304 → 两次请求后 failed，retryAt 60s——有界，不循环 ✓。

### D3 oc/catalog-parse.ts `parseCatalog`:24-36
路径：P1 Array → parseEntries 逐条 readOverlayModel，失败丢弃、有效保留（有限遍历 ✓；"每条仍须校验" ✓）；P2 record 且 `models` 为数组 → 同 P1；P3 record 无 models 数组 → Object.values 逐条，**任一**非有效模型 → 整体 invalid（"不把任意对象当有效空目录" ✓——`{error:{...}}` 拒收）；P4 非数组非 record → invalid。循环终止：entries/value 键有限 ✓。反例：`{models:[]}` → valid 空（合法空目录，官方语义）；`[]` → valid 空 ✓。

### overlay 校验 oc/overlay-model.ts `readOverlayModel`:70-87
顺序拒绝路径：非 record / id 非 1..200 串 / name 非 1..300 串 / type∉{undefined,"chat"}（未知 operation 拒 ✓）/ api 非串或∉apiSet / provider≠sourceId（D"模型 provider 与 sourceId 匹配" ✓）/ baseUrl≠source.endpoint（D"端点不改变已核端点" ✓）/ reasoning 非 boolean / contextWindow|maxTokens 非正有限 / cost 非法（`validatedCost`:37-46：四率非负有限 + tiers 数组条目 inputTokensAbove 正有限+同率形）/ thinkingLevelMap 非 record 或值非 null|string / input 非 ["text"⊆, ∈{text,image}] / compat 已定义但非 record。通过 → 剥离顶层 `headers`（防注入 ✓）→ rest 原样透传（Info-2）。纯函数无副作用。`NaN/Infinity`：`Number.isFinite` 拒 ✓；`-0`：`>0` 拒 ✓。

### D4 oc/catalog-merge.ts `mergeOfficial`:20-28
路径：base 全量入 Map（value 为浅拷贝+provider 重戳）→ overlay 同 key 覆盖 → values 展开。三性质：输入不变（只 spread ✓）；幂等（Map 键决定，重复 merge 同 overlay 结果同 ✓）；overlay 空 → 与"原目录逐条重 stamp provider"等价 ✓（D4"overlay无效时与原实例目录值等价"——注意等价定义=restampModels 语义，与 instantiator.ts:14-16 一致）。反例（INV-2 破坏尝试）：构造 base 内部重复 `type\0id` → Map 折叠丢一条——builtin 目录按 id 键唯一 [source: providers/all.ts getBuiltinModels Object.values(MODELS[provider])，MODELS 为字面量映射，id 唯一]；PRE-C 排除重复 ⇒ 不可达。`identityKey` 的 `type ?? "chat"` 与官方 getModelType 注释一致 [derived: 注释声明，未逐行核官方实现——低风险]。

### oc/catalog-refresh.ts
- `catalogNewer`:54-56 — generatedAt undefined → true（缺世代接受）；否则 lastModified 存在且 >。版本门控源 `getBuiltinModelDataGeneratedAt` = `Date.parse(modelDataManifest.generatedAt)`，NaN→undefined [source: providers/all.ts:100-103]，全内置目录共享世代 ✓。
- `stale`:58-60 / `failureRetryMs`:62-64（rate-limit 取 max(hint,60s)，其余 60s——"retryAt 至少 60s，Retry-After 受界" ✓）/ `cacheEntry`:66-78（纯构造）。
- `notifyUpdated`:80-93 — emit undefined 或 instances 空 → no-op；emit 抛 → catch → warn(`${id}:sync`)（"拒绝仅警告保留下次普通 refresh 同步" ✓，无重试环 ✓）；成功 → void。INV-6 ✓。
- `runCatalogJob`:95-170 — CFG：
  1. 同步前缀：pending=controller、generation 快照（单线程下与 dispose 无交错窗口 [derived: JS 事件循环]）。
  2. await fetch → stale→return（pending 由 finally 清 ✓）；failed → clock 仅改 retryAt（lastGood=overlay 不动 ✓）+ warn(`${id}:fetch:${kind}`) → return。
  3. unchanged → clock 保留 etag/lastModified，checkedAt=now。
  4. no-data → clock={now,0,lastModified:0}（重启后 catalogNewer(0,gen)=false→空 overlay ✓ 保留原模型）。
  5. updated → parse invalid → retryAt+warn→return（整体拒收，不转空目录 ✓）；有效 → `catalogNewer(result.lastModified, gen)` 决定 models 或 []（版本规则 ✓）。
  6. await writeCatalogCache(...,controller.signal) → stale→return（文件残留=合法验证快照，重启重验 ✓）；failed → retryAt+warn → return。
  7. 提交序：先 cache 后 `runtime.overlay/clock`（D8"先验证和私有cache提交，再替换lastGood" ✓）→ `sink.resolve(`${id}:`)`（清警告期 ✓）→ updated 时 await notifyUpdated。
  8. finally：pending===controller 才清（防清掉后来者——单飞下无后来者，防御正确）。
  反例（INV-3）：job 进行中 dispose → disposed=true、generation+1、pending.abort → fetch 抛 disposed → stale → return；已过 fetch 在 write 中 → signal abort → write aborted → stale → return。发布点（行 163-166）前无任何无检查 await ✓。迟到 job 发布窗口：行 154 stale 检查与行 163 赋值间仅有同步代码 ✓ 不可达。
- `createCatalogRefreshModels`:172-188 — 路径：委托 original.refreshModels（PRE-C 下恒 undefined，分支不可达但保留 D6 义务 ✓）；disposed→return；`publish({update:()=>{}}`) false→return（宿主代次/中止淘汰 [source: models.ts publishProviderModels 生成检查]）；!allowNetwork‖signal.aborted‖disposed→return（INV-9：cache-only 只 publish ✓，且宿主 cache 阶段 force 恒 undefined [source: runProviderRefreshPhase `force: allowNetwork ? force : undefined`]）；now<retryAt→return；非 force 且未到 TTL→return；pending 占用→return（单飞 ✓）；`void runCatalogJob().catch()`（INV-6 ✓）。

### oc/catalog-owner.ts
- `restoreOverlay`:42-45 — miss→[]；hit→catalogNewer 决定（INV-7 的启动即时生效路径：cache 更新于世代 → 未联网即有 overlay ✓）。
- `warnCacheMiss`:47-53 — reason==="missing" 不警告（"初装 missing 不是 error" ✓）；其余 warn 一次。
- `createRuntime`:55-85 — miss→warn；hit 重建 clock（checkedAt/retryAt/validators）。副作用仅 sink。
- `wrapCatalogInstance`:87-98 — disposed→原 getModels；否则 merge(原 getModels 实时, overlay, original.id)（P/M"O 为每次实时结果" ✓，"按实例 ID 重戳" ✓）。`refreshModelsAuth:"configured"` [source: pi-ai models.ts:204/648——无存储凭据也运行 refreshModels；目录刷新不依赖凭据，必需且正确]。
- `createCatalogOwner.compose`:112-128 — disabled→original（PI_PROFILE_CATALOG_SYNC=0 ✓ 不禁身份）；resolve 失败→original；runtime 复用/创建（await readCatalogCache 期间 attach 理论可发生——仅 /add-login 于 session_start 后路径，attached 已设，emitUpdate 正确传入 ✓）；`instances.add(original.id)`；wrap 返回。catch-all→original（D6 装配失败仍注册 ✓；所调函数均设计为不抛，catch 为异常兜底）。
- `attach`:130-134 — 绑 hooks、sink.attach、既有 runtime 补 emitUpdate（"attach 后 notify" ✓）。
- `dispose`:135-142 — 先 disposed/generation/emitUpdate=undefined 后 pending.abort（D9 顺序 ✓）；F1/F2 见 §0。

### oc/catalog-warnings.ts
- `warn`:37-49 — 同 key 活跃期去重 ✓；未 attach→buffer；channel 抛→stderr 回退 ✓（"警告输出失败不 throw" ✓）。message 为固定非秘密模板串（调用点仅插 sourceId/reason/kind——均非凭据 ✓）。
- `resolve`:50-54 — 前缀清除（Set 迭代中 delete 安全 [derived: JS Set 语义]）。
- `attach`:55-65 — 换 channel、flush buffer、清空。二次 attach（多 session_start）：channel 替换、buffer 已空，幂等 ✓。

### 接线
- `provider-profiles-extension.ts:36-87` — 序列：getAgentDir→createCatalogOwner→读配置→校验→逐 entry instanceProvider→`await compose`→registerInstances（P/M 顺序 ✓）；`registerAddLoginCommand(pi,...,catalogOwner)`；session_start→attach（notify: hasUI?ctx.ui.notify:safeStderr——print/json 无 UI 走安全 stderr ✓；onUpdated: `ctx.modelRegistry.refresh({allowNetwork:false, providers:[...ids]})`——限定实例、禁网同步快照 ✓ D8；refresh 返回 {aborted,errors} 不 throw [source: models.ts refresh]，即便 throw 也被 notifyUpdated catch ✓）；session_shutdown→dispose。注册/构造错误走既有 console.error 路径，未改。
- `commands.ts:137-151` — `/add-login`：upsert 成功后 `instanceProvider`→`await catalogOwner.compose`→`pi.registerProvider`（D10 与 factory 同路径 ✓）；失败→警告"下次重启生效"，不回滚文件（既有语义保留）。

## 4. 关键不变量反例汇总

- INV-1（身份/transport）：反例尝试=wire 模型带可变请求面字段——`headers` 顶层剥离、`baseUrl`/`api`/`provider` 强等值、rest 字段仅进入目录展示与请求体构造参数（stream 按 api 分派 [source: principles Q.A.7 记录]）。拒绝 ✓。残留假设：宿主不读取模型级 headers 于 provider 目录（Q.A.8 的 model headers 仅 models.json override 路径 [source: provider-composer.ts:527 限于 override]）。
- INV-3（旧 job）：见 runCatalogJob 反例——全发布点前置 stale 检查，无窗口。✓
- INV-5：fetch 全选项枚举无凭据/env 读取 [source: catalog-fetch.ts:73-82]。✓
- INV-9（无递归）：onUpdated→refresh(allowNetwork:false)→refreshModels cache 相→publish 后 return（行 179 首条件）。反例：cache 阶段 force？宿主恒 undefined。✓
- 可见性闭环 [source: model-registry.ts:65 `[...this.runtime.getModels()]`]——wrap 的 getModels 即注册表可见目录；用户 modelOverrides 在其上再套 [source: provider-composer.ts:558,577-578 "topmost user-config layer"]。✓ 设计两条优先级均承接。

## 5. QPDI SCCO 映射（整体判断）

- Q→P：GLM-5.4 免重登继承 ↔ compose 只换 getModels/refreshModels；不借凭据 ↔ INV-5+Q.I.3（auth 包装仍是 instantiator 原逻辑）；非干扰 ↔ 返回 original 的全部异常路径。
- P→模块→函数：D1→catalog-source；D2/D5→catalog-cache；D3→catalog-parse+overlay-model；D4→catalog-merge；D7→catalog-fetch；D8→catalog-refresh+owner attach；D6/D9/D10→catalog-owner+两接线；警告→catalog-warnings。全部实际函数落位，无悬空 P。
- 函数→测试 [derived，仅按文件存在性映射，未逐断言核对]：`test/official-catalog-unit.test.ts`（parse/merge/overlay/fetch 纯函数）、`official-catalog-refresh.test.ts`（TTL/单飞/迟到/取消）、`official-catalog-owner.test.ts`（compose/attach/dispose/缓存恢复）、`official-catalog-loader.test.ts`（extension 启动路径）、`test/fuzz/*`（另一 child，PENDING——内容未读，不采信任何通过自述）。**矛盾**：无致命；F1/F2/F3 为局部字面偏差，不动摇整体 Soundness。
- 完整性缺口（Complete 的未覆盖项）：Fuzz A(≥10k)/B/C(≥256×32)/D 与 Docker 隔离网络未完成或未核；真实 tmux 全项（工具/重启/用户亲验）由主会话归档，本报告不替代；测试断言级交叉核对未做。故整体判定不高于 PARTIAL。
- Concise/Orthogonality：无新增 virtual/bridge/全局状态/第二凭据目录；所有可变状态封在 owner 闭包 per-factory（设计"任务、代次和 owner 只在本 factory 内" ✓——多 extension 实例各有 owner，互不共享 [source: createCatalogOwner 每次调用新闭包]）。

## 6. 源码论证 vs 测试实证（分开）

- 源码论证（本报告）：上表，全部 in-scope 函数/分支/循环/await 拒绝路径覆盖；自然语言 Hoare，非机器证明。
- 已有测试实证 [source: 任务书给定，未复跑]：`mechanism/out/official-sync-refresh-fixed.log` 29/29 exit0（机制 log 只证组合原语）；主会话 `npm run check` exit0（类型级，覆盖面未证）；主会话 tmux `pp-official-a-check zai-001-g-l/glm-5.4` OK + ShiftTab 档位 + context 前后 1.0M（真实加载/显示证据，主会话归档）。
- PENDING：Fuzz 全套、Docker、工具调用/重启/用户亲验、本插件在根 check 中的类型覆盖确认。

## 7. 最小修复方向（不实施）

1. F1：`createCatalogOwner` 加 `let closed = false`，`dispose` 置 true，`compose` 首查 `closed`→original。
2. F2：dispose 循环体改 `if (runtime.disposed) continue;`。
3. F3：`readBoundedBody` reader undefined 分支改返回 `{ok:false, kind:"invalid"}`（放弃 text() 回退），或在测试 harness 约束注入 fetcher 恒有 body。
4. 未闭合测试项：对 F1 补"dispose 后 compose 不建 runtime"用例；F3 补"body 缺 reader"输入分类用例；既有 fuzz child 完成后按 §5 缺口清单回收。

## 8. 证据标签索引

source=直接读到（文件:行 或 包源码）；derived=由 source+语言/框架语义推出；assumption=§4 标注的宿主行为假设（模型级 headers 不用于 provider 目录请求头；MODELS 字面量 id 唯一）；unresolved=宿主版本 1.5.2(仓库) vs 1.6.0(运行时) 接口漂移未核。
