# provider-profiles 测试执行记录

## 当前状态（2026-09-22）

当前实现的最新聚焦套件为 **68 通过、1 个 T-34 生命周期跳过（共 69）**；`npm run check` 也通过。下方按时间保留早期 46/2/1、T-12 修复、来源泛化、命令、补全及 models.json 覆盖等证据，不应把早期失败或旧字段名当作当前结论。当前 QPD 规范在 `principles.md`、`architecture.md`、`detailed.md`。

## 执行资格与命令

- 执行时间：本次实现会话；Vitest `4.1.9`。
- 命令（仅插件目录）：`cd my-plugins/provider-profiles && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run`。
- 最终运行：49 个 Vitest 用例中 **46 通过、2 失败、1 跳过**；失败均为保留的 T-12 产品缺陷复现，跳过为 T-34。
- 类型诊断：同一命令加 `--typecheck` 报告 **`Type Errors no errors`**；行为结果仍为上述 46/2/1。
- 官方目录基线：仓库 `packages/ai/package.json` 与 `npm pack @earendil-works/pi-ai@0.86.1` 解包的官方 tarball 都是 `0.86.1`。tarball 为 `/tmp/pp-catalog-0861/earendil-works-pi-ai-0.86.1.tgz`（npm 报告 shasum `ece82487686aa5700c6db8b36d90a2daf1a78ba9`），目录基线为 `/tmp/pp-catalog-0861/package/dist/providers/data`，实际含 42 个 JSON，含 `openai-codex.json`、`zai.json`、`zai-coding-cn.json`。
- `vitest.config.ts` 仅对缺失的 `packages/ai/src/providers/data/*.json` 导入定向到上述精确版本、只读的官方目录；其余 `@earendil-works/pi-ai` 解析仍继承仓库 `vitest.base.ts` 的源码别名。曾检查的全局目录实际为 `0.87.0`，已弃用，未作为本次基线。
- 所有凭据、模型配置、目录、注册宿主及文件均为合成夹具；未读真实 `auth.json`、未走 OAuth、未发起网络请求。

T 级主状态为 **32 通过、1 失败、1 阻塞**。下表中的“宿主阻塞”是该 T 仍不可在 Vitest 闭合的指定宿主子观察，不把单元层通过伪装成宿主级通过。

## T-01 至 T-34

| T | 真实绑定对象与子例 | 结果 | G 项 / 宿主限制 |
| --- | --- | --- | --- |
| T-01 | B01/B02/B03/B04：`providerProfilesExtension`，临时固定配置，记录 `registerProvider` 的 fake Pi；`openai-codex`、`zai`、`zai-coding-cn` 各两个合法实例。 | 通过：6 次且仅 6 次注册，所有 `id === name`。 | — |
| T-02 | B01：`parseEntries`；长度 1/64、数字开头、末尾/连续连字符，以及空、65 长、大小写、下划线、空格、斜杠、非 ASCII、首连字符。B10 的非空坏名输出由 T-08 fake Pi 路径观察。 | 通过：严格正则，合法邻项保留。 | G-03 |
| T-03 | B01/B02/B03/B04/B10：真实 `compat.getProviders()` 全量 id 写入临时配置，fake Pi 记录所有调用，`console.error` 捕获。 | 通过：仅合法邻项注册；每个内置 id 有可识别诊断，未调用其注册。 | G-05 |
| T-04 | B01：`JSON.parse` 后的真实 `parseEntries`；同一文本键两次，旁置合法项。 | 通过：遵循 G-02 的 JSON 后者语义；无自定义重复诊断或重复注册。 | G-02 |
| T-05 | B01/B12：`parseEntries` 的未知来源隔离；B04：`getBase` 对运行时不支持名抛可辨认错误。 | 通过：未知项跳过，邻项保留，C2 不伪造来源。 | G-05 |
| T-06 | B01/B12：`parseEntries` 对 `openai-codex` 的非空与空 `apiKey` 字段，旁置合法 codex/zai。 | 通过：字段出现即拒绝，合法邻项保留。 | G-03 |
| T-07 | B01/B02/B03：`readProfileConfig` 和 `providerProfilesExtension`；截断 JSON；fake Pi 注册记录。 | 通过：`ConfigError`、零注册，原文件未改。 | G-01、G-05、G-10 |
| T-08 | B01/B02/B03/B10：混合合法、未知来源、非法名、OAuth+key，`console.error` 捕获。 | 通过：两个合法项注册，三个坏项均有名称诊断。 | G-03、G-05 |
| T-09 | B01/B02/B03：两个新的完整加载周期；第二次仅修改临时配置增加一个身份。 | 通过：第一周期仅 A，第二周期 A/B；未改产品文件。 | G-01、G-09（不主张热重载） |
| T-10 | B01/B12：`readProfileConfig` 对选中临时文件和诱饵文件；`profileConfigPath()` 对注入 home。 | 通过：仅读所选路径，配置/诱饵未写，固定路径正确。 | G-01、G-10 |
| T-11 | B04/B05/B12：`getBase` 与三个直接官方工厂逐一比较 id、name、完整当期目录；T-26 再观察实例构造后 base。 | 通过：来源与同版本官方工厂一致；无来源替换。 | G-06 |
| T-12 | B02/B03/B10/B12：在真实 extension 的 C2 `getBase` 和 C3 `instanceProvider` 边界各注入一个合法名条目的受控失败，前后各有合法项。 | **失败**：两个子例均使 extension reject，未继续到后项；最小复现见下节。 | G-05；产品缺陷 |
| T-13 | B03/B12：真实 `registerInstances`，中间 fake Pi `registerProvider` 抛错。 | 通过：调用 first/middle/last，成功清单仅 first/last，middle 有失败项。 | G-05 |
| T-14 | B06：两个真实 zai 系 base 的 `wrapApiKeyAuth.resolve`；合成 stored key → profile key → 无 key，`ctx.env` spy。 | 通过：解析序为 stored/profile/`undefined`，未读环境。 | G-04；B08/B09 宿主可用性/请求观察阻塞 |
| T-15 | B06：两个 zai 系仅合成环境 key、无 stored/config key，调用真实 wrapper resolve。 | 通过（单元）：均为 `undefined` 且未读环境。 | B08/B09 真实可用列表/执行入口阻塞 |
| T-16 | B06：目标实例 resolver 只给空自身凭据输入，环境 spy 为外部来源探针。 | 通过（单元）：未读取 A/其他槽位的任何可达外部入口，结果 `undefined`。 | B07/B08/B09 真实登录、槽位和执行阻塞 |
| T-17 | B06：无自身输入、合成环境/外部来源探针；真实 wrapper。 | 通过（单元）：不发生外部回退。 | B08/B09/真实内置槽位审计阻塞 |
| T-18 | B06：以“logout 后自身 credential 缺失”的合成输入重解析。 | 通过（单元）：无 profile key 时保持 `undefined`，不读环境。 | B07/B08/B09 真实 logout 生命周期阻塞 |
| T-19 | B06：空 stored key 加仍存在的自身 profile key。 | 通过：按 G-04 当作缺失，返回自身 profile key，不读环境。 | G-04；宿主 logout 操作阻塞 |
| T-20 | B07 单元等价：真实 zai `ApiKeyAuth` 的 `login` 引用与 wrapper 相同。 | 通过（引用）：未重建官方登录函数。 | 真正 `/login` 和写入自身 credential 槽位阻塞 |
| T-21 | B04/B07 单元等价：真实 codex `auth`/`oauth` 为同一引用。 | 通过（引用）：OAuth auth 未包装。 | 真正 OAuth 刷新成功/失败和槽位隔离阻塞 |
| T-22 | B05/B09 单元等价：同一 zai base 构造 A/B；模型归属分别为 A/B，`stream`/`streamSimple` 均与 base 同引用。 | 通过（引用/归属）：不做真实网络调用。 | 显式选择后的真实出站凭据与两条请求路径阻塞 |
| T-23 | B05/B06：无凭据实例的真实目录仍非空，真实 wrapper resolve 为 `undefined`。 | 通过（单元）：目录和认证解析分离。 | B08 真正 ModelRuntime 可用列表及刷新屏障阻塞 |
| T-24 | B06：真实 wrapper 在无自身来源时返回 `undefined`，环境 spy 未被调用。 | 通过（单元）：失败不触发外部回退。 | B07/B09 真实远端拒绝/刷新失败路径阻塞 |
| T-25 | B04/B05：三个同版本直接官方工厂目录与 `instanceProvider(...).getModels()` 逐项 `toEqual`，仅期望 `provider` 重戳。 | 通过：完整目录、嵌套字段和所有当期字段保真。 | G-06 |
| T-26 | B04/B05/B12：每个来源构造 A 后 B，再读 A/B/base。 | 通过：A/B 归属独立，base 目录未改。 | G-06 |
| T-27 | B04/B07/B09：三个来源真实 `stream`、`streamSimple`；zai `login`，codex auth。 | 通过：文档要求的函数/对象引用共享。 | 真实登录、OAuth 刷新、网络流阻塞 |
| T-28 | B12：真实 zai base 加 `refreshModels`、`filterModels`、白名单外 probe 的测试边界扰动，再调用 `instanceProvider`。 | 通过：自有字段恰 8 个，三种禁止能力均不进入实例。 | G-07（显示名不作为身份判据） |
| T-29 | B05/B12：真实 zai-cn base 加捕获性 refresh/filter probe，构造实例后审查能力和目录归属。 | 通过（单元）：实例不携带闭包，目录均重戳。 | 宿主实际刷新/筛选调用链阻塞 |
| T-30 | B03/B04/B11：临时 `models.json` 与内置列表快照；正常、混合非法、坏 JSON 三个加载。 | 通过：无内置 id 注册调用，`models.json` 字节和目录清单不变。 | G-10 |
| T-31 | B06：真实 wrapper 只接收合成自身 credential，环境 spy 为越权读哨兵。 | 通过（单元）：返回自身 key，未触发外部读。 | 真实 auth.json 逻辑槽位读/写审计阻塞 |
| T-32 | B11/B12：注入临时 home，`node:fs/promises.writeFile` 包装审计在夹具完成后清零；比较 models/sentinel 内容和递归目录快照。 | 通过：被测 extension 无写调用，范围外 sentinel 未变。 | G-10 |
| T-33 | B04/B13 的 Vitest 别名层：三个 `provider-source` 静态工厂导入可加载、目录非空且等于同版本直接官方工厂。 | 通过（别名资格）：不是 T1 真实 Pi 闭合。 | G-08；真实扩展运行时仍待阶段 5 |
| T-34 | B14：`test.skip`，名称写明需真实 Pi disable/reload/exit/new-process。 | **阻塞**：Vitest fake Pi 不具备进程生命周期。 | G-09 |

## 对抗轨迹记录

| 轨迹 | 运行的真实断言 | 结果 |
| --- | --- | --- |
| AT-01 | T-15/T-23 的 zai 与 zai-cn 无自身 key、环境 spy、目录/resolve。 | 单元通过；B08/B09 宿主执行仍阻塞。 |
| AT-02 | T-16/T-22/T-31 的无外部回退、A/B 模型归属和 resolver 输入审计。 | 单元通过；真实 A 登录/出站槽位阻塞。 |
| AT-03 | T-17/T-31 的无自身来源和环境探针。 | 单元通过；真实内置 credential store 审计阻塞。 |
| AT-04 | T-18 的 post-logout 缺失输入重解析。 | 单元通过；真实 logout/可用性更新阻塞。 |
| AT-05 | T-14/T-19 的 stored 优先、空 stored 和自身 config fallback。 | 通过。 |
| AT-06 | T-25/T-26 的三官方目录全字段比较、A/B/base 再读。 | 通过。 |
| AT-07 | T-07/T-30 的截断 JSON、零注册和文件快照。 | 通过。 |
| AT-08 | T-05/T-08 的 unknown provider 位于合法项之间。 | 通过。 |
| AT-09 | T-02/T-08 的名称边界、非法名和邻项继续。 | 通过。 |
| AT-10 | T-03/T-30 的真实全量 built-in id、注册过程和快照。 | 通过。 |
| AT-11 | T-04 的重复文本键。 | 通过 G-02 已裁决的 JSON 后者语义；不伪造冲突策略。 |
| AT-12 | T-06/T-08 的 codex `apiKey`（空/非空）与合法邻项。 | 通过。 |
| AT-13 | T-30/T-32 的 models.json、范围外 sentinel 和写审计。 | 通过。 |
| AT-14 | T-23 的无凭据目录/resolve，T-15 的无环境回退。 | 单元通过；真实可用列表阻塞。 |
| AT-15 | T-28/T-29 的 future-source probe 和禁止闭包。 | 单元通过；真实宿主 refresh/filter 调用阻塞。 |
| AT-16 | T-21/T-24 的 OAuth 引用与失败不回退单元层。 | 单元通过；真实刷新/远端失败阻塞。 |

## 保留的产品缺陷：T-12

最小复现均在 `test/extension-isolation.test.ts`，且没有改动产品代码。

1. **C2 source acquisition**：配置为合法 `first` (`openai-codex`)、合法 `broken-source` (`zai`)、合法 `last` (`zai-coding-cn`)；测试仅在真实 `getBase("zai")` 边界注入 `Error("synthetic source failure: zai")`。判据要求记录 `broken-source` 的可见条目错误并继续注册 first/last。实际 `providerProfilesExtension` 在 `provider-profiles-extension.ts:31` 的 `entries.map(...)` 直接 reject。
2. **C3 instance construction**：同样配置，测试仅在真实 `instanceProvider` 接收 `broken-instance` 时注入错误。判据同样要求条目隔离；实际仍在同一 `entries.map(...)` 直接 reject。

根因是 C2/C3 组装发生在未捕获的 `entries.map` 内；`registerInstances` 之后才有的条目级错误处理无法处理这两类错误。该缺陷使后项不被注册，且不会走 `console.error` 的条目诊断。失败测试保留，未以 `skip` 或放宽断言规避。

## 未闭合宿主观察

- 真实 `ModelRuntime` 的 `/model` 可用列表和更新屏障（B08）需要真实 Pi 宿主。
- 真实 credential store 的按 provider-id 读/写/删、`/login` UI、OAuth 刷新成功/失败（B06/B07）需要真实 Pi 宿主且禁止在本测试中使用真实凭据。
- `stream` 与 `streamSimple` 的真实网络分发（B09）未执行；这里只断言生产函数引用和模型归属。
- T-33 只证明 Vitest 源码别名资格；T1 在真实 Pi 扩展上下文才能闭合。
- T-34 完全阻塞，需真实 Pi 进程观察 disable、reload、exit 与新进程状态。

## 修复记录（主会话，2026-09-22）

T-12 缺陷已由实现所有者修复：`provider-profiles-extension.ts` 将 C2/C3 组装从无保护的 `entries.map` 改为逐条目 try/catch，构造失败并入条目错误流（可见诊断 + 其余条目继续注册）。复跑全部插件测试：**48 通过、1 跳过（T-34，需真实 Pi 进程）**；T-12 两个原失败子例现通过。

## 真实 Pi 隔离冒烟（阶段 5，2026-09-22，全局 pi 0.87.0 + 临时 PI_CODING_AGENT_DIR）

- **T1 闭合（负面+正面）**：`@earendil-works/pi-ai/providers/<name>` 子路径被 built 扩展运行时拒绝（VIRTUAL_MODULES 清单外）；改用 `@earendil-works/pi-ai/providers/all`（清单内）后加载成功。provider-source.ts、provider-source.test.ts 已同步改道。
- **P6**：坏名与内置名冲突两条目具名跳过，其余注册；console 输出可见。
- **P1**：codex-smoke / zai-smoke / zai-smoke-key 三实例注册，id=配置名。
- **P7**：可用列表只出现带自身凭据的 zai-smoke-key；codex-smoke（未 OAuth）、zai-smoke（无 key）不出现在 --list-models。
- **P3**：zai-smoke-key 模型 max-out 显示 131.1K 官方值（E1 手抄 16.4K 默认坑未复现）。
- **P2 接线**：`--model zai-smoke-key/glm-5.3-flash` 请求实际到达真实 Z.ai 端点并返回 `401 token expired or incorrect`（dummy key），错误如实透出，无静默借号。
- **附带产品修复（阶段 4/5，I 层）**：① T-12 条目隔离（C2/C3 组装纳入逐条目 try/catch）；② profileConfigPath 镜像 PI_CODING_AGENT_DIR 覆盖语义（冒烟发现的静默空配置缺陷）；③ C2 导入通道改 providers/all。全部复跑：vitest 48 通过 / 1 跳过（T-34 需真实进程生命周期观察，README 已记录边界）。

## 修复轮回归（2026-09-22，G-01/G-02/G-07 闭合后）

- 新增 `test/gap-fixes.test.ts`（7 项）：G-01 env 覆盖委托、G-02 models.json denylist（冲突拒绝+邻项继续+读取器三态）、G-07 保留键（constructor 拒绝 + 非精确小写变体合法）。
- **[历史]** `parseEntries` 曾扩展第三参 `modelsJsonIds`；该字段已被现行 `modelsJsonConflicts` 内容分类取代。vitest 经 `test/host-exports.ts` 路由真实 `getAgentDir`。
- 全套：**55 通过 + 1 阻塞跳过（T-34），共 56**。
- 真实 Pi 隔离冒烟（临时 PI_CODING_AGENT_DIR + models.json 冲突注入）：四类拒绝全部具名可见（坏名/内置冲突/保留键 constructor/models.json 冲突），codex-smoke、zai-smoke、zai-smoke-key 照常注册，可用性语义不变。

## /add-login 功能轮（2026-09-22）

- 新增 commands.ts（/add-login：help 六形态、Tab 补全第二位 provider、同名拒绝、参数校验）、config-writer.ts（读改写+整体重校验+原子 rename）、instantiator.ts `resolveEnvTemplate`（$VAR/${VAR}/$$ 展开，缺失=未配置；不支持 !command——修正 README 此前超宣称）。
- 测试 +9（test/add-login.test.ts）：help 面、即时注册与文件保留、env 引用原样存储、同名拒绝且文件不动、models.json 冲突、保留键/未知 provider、参数指引、补全位置语义、模板展开三态。
- 全套：**65 通过 + 1 阻塞跳过（T-34），共 66**。/rm-login 按用户裁决不做命令（残留风险），删除方法写入 help。

## Tab 补全修复轮（2026-09-22，用户实测三缺陷）

- 根因：补全引擎契约是 `value` **整段替换**参数区（autocomplete.ts applyCompletion，prefix=完整参数文本），原实现误按 token 补全写。
- 修复：provider 候选 value = `<name> <provider>`（保 name）；首位（无空格/空前缀）补 help 关键字（help/h/-h/--help/?）；第三位（apiKey）不补返回 null。
- tmux 实测：`/add-login `+Tab → `/add-login help`；`acct1 za`+Tab → `acct1 zai`；`acct1 `+Tab → `acct1 openai-codex`（可继续 Tab 轮换）。文件补全误弹消除。
- 全套：**67 通过 + 1 阻塞跳过（T-34），共 68**。

## 补全状态模型重写（2026-09-22，用户裁决）

- 模型：按参数位置状态而非字符前缀——A 态（命令后仅空白）→ 单个 `help` 候选；B 态（首 token 是 help 前缀）→ `help`；B' 态（首 token 是 NAME，无论有无尾随空格）→ provider 候选且 value 保留 name（Tab 在 name 后直接续 provider）；D 态（apiKey 位）→ 无补全。`-h/?` 等仍可手输执行，不再进入候选。
- tmux 实测：`/add-login `+Tab → help；`mk-1`+Tab → `mk-1 openai-codex`（可轮换）；C-u 重打后行为一致。
- 已知宿主行为（非本插件）：命令名补全（如 `/a`+Tab）刚应用后，紧随的 Tab 不触发参数补全，清行重打即恢复——内置 `/login` 同样复现（`/lo`+Tab+Tab 无反应），属引擎 ghost/apply 生命周期，插件层无法干预。
- 全套：**68 通过 + 1 阻塞跳过（T-34），共 69**。


## 来源泛化轮（2026-09-22，用户裁决）

- `provider-source.ts` 重写：动态支持集 = `builtinProviders()` − refreshModels 携带者（现仅 radius）；`isOAuthSource`/`builtinIds`/`supportedSourceIds` 从工厂产物派生；进程内只读缓存。46 工厂分类事实见 principles Q.A.6。
- **[历史→现行演进]** `SUPPORTED` 常量删除后，provider 校验改 ValidationContext；现行字段为 `nameDenylist/modelsJsonConflicts/supportedSources/oauthSources`，不可识别 provider 一律拒绝。
- `commands.ts`：补全候选动态化；未知 provider declined；oauth 规则动态（`isOAuthSource`）。
- 测试适配 + 新增（动态 oauth 集、declined 文案、动态补全集包含性）；README/detailed/architecture/principles 同步（Q.I.7 身份层边界、Q.A.6/12/13、E4）。
- 全套：**68 通过 + 1 阻塞跳过（T-34），共 69**；tmux 冒烟：`not-a-provider` declined ✓、`y `+Tab 动态候选 ✓。

## 同名 models.json 安全覆盖修复（用户反馈后，2026-09-22）

- 旧逻辑错误地把所有同名 provider 键列为冲突；真实配置里的 codex-001/002/999 只有 `modelOverrides.contextWindow`，均被误拒。本轮按宿主 composer 语义改为按**配置内容**分类：仅含 `modelOverrides` 且无模型级 `headers` 的同名条目允许；provider 级字段或模型级 `headers` 仍拒绝。
- `readModelsJsonConflicts` 按宿主 `ModelConfig.load` 的 JSON 注释、尾逗号与 BOM 词法处理读取 models.json（只读），不再按键是否存在作判断。
- 插件测试：**68 通过、1 阻塞跳过（共 69）**，覆盖纯窗口覆盖、provider 级 key/baseUrl、模型级 Authorization header、注释/尾逗号/BOM、/add-login 同名允许/危险拒绝。
- 隔离 Pi 真实合成：`safe-zai`（同名模型窗口覆盖）注册并显示 543.2K，`unsafe-zai`（同名 apiKey）具名拒绝；用户真实 Pi 启动后 codex-001/002/999 与各自的模型窗口覆盖均出现。没有修改任何 models.json 文件。

## QPDI 文档同步与 Copilot 过滤继承（2026-09-22）

- `instanceProvider` 现在仅在 C2 明确批准时转发 `filterModels`；真实 `github-copilot` 的 OAuth `availableModelIds` 过滤被委托保留，任意注入 probe 和所有 `refreshModels` 仍不复制。
- 当前 Q/D 文件已重组为动态来源、同名 models.json 内容分类、C5 命令和宿主边界的单一现行规范；`test-plan.md`、`correctness.md` 的早期三来源/全键拒绝材料保留为历史并在顶部标注 superseded 范围。
- 聚焦测试：**68 通过 + 1 T-34 生命周期跳过（共 69）**；`npm run check` 通过；真实用户配置中 codex-001/002/999 的同名窗口覆盖可见。
