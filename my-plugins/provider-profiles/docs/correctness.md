# Provider Profiles 正确性报告

本报告是独立报告撰写者对前序已核验发现的转录与组织，不是实现者自证。以下主体审计的是当时 `architecture.md` 的 **P.local.1–7**；现行规范已在本文末“当前审计适用范围”与 QPD 文档中标明，历史反例不被删除，但不得自动投射为现行实现行为。

**推导：bcb59dbd 进展报告，本文做了锚点抽查。** 前序材料声明局部逐路径推导已经完成，反例已有零网络内存探针复现；本文核读五份设计/测试材料、七个产品源文件，并抽查下列宿主调用链，但没有重新运行这些探针。下文的 PROVEN 只用于已逐路径追踪的局部结论，不意味着同名性质在宿主合成、凭据适配、刷新或 UI 边界后仍无条件成立。未重新核验的原始运行结果保持前序判定并明确注明。

**总览：八项反例缺口；P7 = PARTIAL（3）。** 另保留 C4 延迟提交风险及 T-34 生命周期阻塞，不把风险伪报成已观察失败。为避免混淆，本报告的 G-01–G-08 属于本报告命名空间；它们不是 `test-plan.md` / `detailed.md` 中同号设计待决项。例如，本报告 G-08 是 scoped UI 缺口，测试计划 G-08 则是 T1 导入通道问题。全局刷新的一项前序发现按“异槽读取”和“异 provider 持久化”两个独立义务分别记为 G-05、G-06。

除以 `packages/` 开头的宿主路径外，文中源文件与文档路径均相对于 `my-plugins/provider-profiles/`。本文的 PARTIAL 表示部分义务已有证明，但存在反例或未闭合依赖；并不把未闭合依赖等同于实际失败。

## 一、逐函数 `{Pre} NSP {Post}`

本节共用前提：有限、正常的 JSON 数据与官方 Provider 对象；宿主 API 符合其类型契约；不把内存耗尽、任意恶意 getter 或日志设施故障纳入纯数据变换证明。每节的局部 PROVEN 均转录自 bcb59dbd 的逐路径推导；本文核对了所列实现锚点。

### 1. `parseEntries`：分支穷尽与 `continue` 不变式

锚点：`config-entry.ts:27–78`；判据：`detailed.md:99–110,143–146`。

- **Pre**：`raw` 是文件层已验证的顶层对象映射；`builtinIds` 是本次加载取得的内置 provider id 集合。
- **NSP**：按 `Object.entries(raw)` 遍历；依次校验 name 正则、内置 id 冲突、条目对象形状、受支持 provider、OAuth/API-key 组合与 API-key 值。
- **Post（历史审计版本）**：每个已解析的自有条目恰进入 `entries` 或 `errors` 之一；合法输出只含 `name`、当时三种受支持 `provider` 及可选的非空字符串 `apiKey`；每项错误携带原条目名；不改输入、不访问凭据、不注册。现行动态来源与同名内容分类见 QPD 文档和本文后记。

循环不变式：处理完前 k 项时，前缀中的每项已被恰好分类一次；后缀未处理；合法项的顺序保留。坏名、内置冲突、非对象/null/数组、未知或非字符串 provider 均在追加错误后 `continue`。`openai-codex` 的非 `undefined` `apiKey` 被拒；zai 系的缺省 key 可接受，非字符串或空字符串被拒。只有穿过全部检查的路径追加 entry，故不存在“已报条目错又进入注册输入”的路径，坏项也不会阻止下一项。

**结论：PROVEN（C1 局部）**。重复 JSON 文本键由 `JSON.parse` 取后值；不是插件识别并报告了重复键。该行为是 `detailed.md:144` 已裁决的边界。字符串全为空白未被额外拒绝，但既有契约只拒绝空串，不在本文新增规则。`constructor` 匹配正则且不是内置 id，因此合法通过；它在宿主凭据存储处形成 G-07，而不是 C1 的分支遗漏。

### 2. `readProfileConfig`：文件层异常出口

锚点：`config-loader.ts:20–40`；判据：`detailed.md:108`。

- **Pre**：传入待读取的配置路径。
- **NSP**：读取文本 → JSON 解析 → 顶层对象形状检查。
- **Post（正常）**：文件缺失 `ENOENT` 返回空对象；合法顶层对象原样交给 C1。函数只读取指定文件，不注册、不写文件。
- **Post（异常）**：非 `ENOENT` 读取错误、坏 JSON、顶层 null/数组/非对象均成为含路径与原因的整体 `ConfigError`，不返回部分配置。

读取、解析、形状检查的失败出口覆盖了文件层的三种异常来源。工厂在此返回前没有调用注册，因此这些异常使本次加载产生零次插件注册调用；这不代表会清除上次加载的实例。

**结论：PROVEN（给定路径的文件层）**。路径是否选对不是此函数的后置条件；`profileConfigPath` 的 G-01 不能被“ENOENT 当空配置”掩盖。

### 3. `getBase`：官方来源与失败出口

锚点：`provider-source.ts:9–19`；上下游：C1 → C2 → C3。

- **Pre**：名称来自 C1 的三种受支持 provider；`providers/all` 在当前扩展环境可加载。
- **NSP**：调用官方 `builtinProviders()`，按 `provider.id === name` 查找。
- **Post**：找到时返回官方工厂集合中的相应 Provider，不修改它；未找到则抛出含 provider 名的错误，由工厂按条目隔离。

查找只有“找到/未找到”两个出口。受支持集合的运行时边界由 C1 承担，不能把此函数解释成对任意 JavaScript 字符串重新执行完整支持名单校验。模块顶层导入失败先于工厂执行，属于整体环境失败而非某个条目失败。

**结论：PROVEN（上述 Pre 下的 C2）**。三工厂的静态目录、id 无关行为及每次工厂产物独立性沿用前序核验和 Q.A.6，本轮未重读三工厂全文。实际通道为 `providers/all`，不是 `detailed.md:88–95` 尚存的三个单 provider 静态子路径表述；修正依据已在 `principles.md:143–149`、`test-results.md` 的真实冒烟记录中。本文记录这处既有文档差异，不修改既有文档。

### 4. `restampModels`：逐元素保持

锚点：`instantiator.ts:11–13`；判据：`detailed.md:14–18`。

- **Pre**：官方 `getModels()` 给出的普通模型数据对象数组；name 已通过 C1。
- **NSP**：`models.map((model) => ({ ...model, provider: name }))`。
- **Post**：新数组与输入等长、同序；每个模型是新对象，`provider === name`；其余模型数据字段与对应输入相等，嵌套对象沿用同一引用；输入数组和输入模型不被修改。

逐元素复制后最后写入 `provider`，保证不会被旧值覆盖；空数组路径自然返回空数组。浅复制不是深隔离承诺：后续外部修改共享嵌套对象不在此纯函数证明内。

**结论：PROVEN（C3 输出点）**。宿主后续 `models.json` 合成可改变模型元数据，见 G-02；局部复制正确不能据此外推最终模型快照完全等于官方目录。

### 5. `wrapApiKeyAuth.resolve`：三分支与 abort

锚点：`instantiator.ts:16–37`；判据：`detailed.md:20–29,63–66`。

- **Pre**：输入为官方 zai 系 API-key handler；`configKey` 为经 C1 验证的非空字符串或 `undefined`；传入的 credential 是宿主实际交给 wrapper 的值。
- **NSP**：保留 `auth.name`、`auth.login`；以自有 resolver 替换官方 resolver。
- **Post**：严格按下表解析；无 `ctx.env` 调用、无网络、无缓存、无凭据存储调用；`login` 为原函数引用。

| 路径 | 条件与结果 |
|---|---|
| abort | 入口 `signal?.throwIfAborted()`；存储 key 分支另有一次检查。已观察到的取消抛出/拒绝，不返回认证结果。 |
| ① 本次传入的存储 key | `input.credential?.key` 为真值时，返回此 key、原 `credential.env`，来源为 `stored credential`。 |
| ② 自身配置 key | ① 不成立且 `configKey !== undefined` 时，返回配置 key，来源为 `profile config`。 |
| ③ 缺凭据 | 前两项均不成立时返回 `undefined`。 |

空或缺失的存储 key 落入②或③；这是 `detailed.md:146` 的既定 truthiness 语义。函数内部没有 await，返回后发生的取消不是本次解析必须追溯撤销的状态。

**结论：PROVEN（wrapper 局部）**。这里“存储 key”只描述参数来源标签，不证明其更上游未被替换或展开。G-02 的合成器注入、G-03 的 runtime key、G-04 的存储值环境展开都可在 wrapper 之前发生；G-07 则使宿主根本不调用 wrapper。

### 6. `instanceProvider`：白名单封闭与引用义务

锚点：`instantiator.ts:44–59`；判据：`detailed.md:31–69`。

- **Pre（历史审计版本）**：C2 返回的未修改官方 base，加 C1 合法 entry；当时目标集合为三种既定工厂。当前实现的动态工厂分类属于本文审计后的范围。
- **NSP**：仅构造八个显式字段；API-key handler 存在时替换其 resolver，否则保留原 auth 对象。
- **Post**：自有字段恰为 `id, name, baseUrl, headers, auth, getModels, stream, streamSimple`；不含 `refreshModels`、`filterModels` 或其他顶层探针字段。

`id = entry.name`；显示名为 `${base.name} (${entry.name})`；`baseUrl`、`headers`、两个 stream 函数直接引用 base；每次 `getModels()` 都读取 base 当前目录再重戳。codex 在既定工厂形态下没有 API-key handler，因此共享 `base.auth`；zai 系保留其余 auth 字段并使用前节 wrapper，不复制一套登录或 OAuth 刷新算法。构造不改 base，不读存储，不立即请求模型或网络。

**结论：PROVEN（C3 输出点）**。未来官方新增顶层字段不会自动进入实例；未来工厂/auth 结构变化仍须重新论证，不能凭白名单免除复核。宿主合成后的对象不是本函数返回对象，故 G-02 可以同时破坏最终引用共享与八字段形状，而不反驳本节局部证明。

### 7. `registerInstances`：同步异常隔离

锚点：`registrar.ts:22–39`；判据：`detailed.md:112–120`。

- **Pre**：输入是已构造的实例序列；注册 API 接受 native Provider 形式。
- **NSP**：逐个在 `try/catch` 内调用 `pi.registerProvider(item.provider)`；返回即记入 `registered`，抛出则记入含条目名的 `failed`，继续下一项。
- **Post（可无条件局部证明）**：每项恰调用一次注册 API；同步抛出的该次错误不阻止后项；结果按 API 是否同步抛错分类。

前缀不变式是“每项已调用一次并恰记成功/失败一次”，不是“每项已经在宿主最终提交且失败无残留”。实现没有 await 注册提交、没有撤销或补偿动作。

**结论：PROVEN（同步调用边界）**；“真实提交成功清单”“所有提交失败逐项隔离”“失败后无半注册状态”均不能由此推出。loading 阶段注册只是入队，稍后的失败不在此栈的 `try/catch` 内。该 C4 缺口保留为 **R-C4：依赖宿主提交语义**，不报告已复现提交失败。

### 8. `providerProfilesExtension`：编排与错误分级

锚点：`provider-profiles-extension.ts:21–49`、`index.ts:1`；判据：`detailed.md:122–137`。

- **Pre**：模块已成功加载，内置 id 列表与日志设施可用。
- **NSP**：取得 denylist → 算路径并 await 文件层 → C1 → 逐项 C2/C3 构造 → C4 → 输出汇总错误及已接受注册名。
- **Post**：文件层整体异常向外传播，后续构造/注册不执行；C1 条目错、C2/C3 同步构造错、C4 同步注册错被具名汇总，其余条目继续；无自动轮换、自动换号或插件自有持久化写入。

先完成配置读取再开始任何注册，故坏 JSON 不产生本次半注册；构造循环中每项自己的 `try/catch` 保证坏 base/构造不再截断全部条目。原 T-12 的 `entries.map` 缺陷已在当前实现中消失，与 `test-results.md` 的修复复跑记录一致。错误输出发生在 C4 之后；若宿主把错误推迟到 commit，该错误的传播与显示由宿主承接，不能算进插件的同步错误分类。

**结论：PROVEN（当前编排的局部路径）**。`profileConfigPath` 使用 `process.env.PI_CODING_AGENT_DIR ?? 默认目录` 再 `join`，只证明“算出了这个路径”，不证明与宿主目录解释等价；该差异即 G-01。`index.ts` 仅重导出，没有另一条隐藏编排路径。

## 二、跨边界契约：ASSUME 与锚点核验表

下表把宿主前提显式化。**ASSUME 不是 PROVEN**；表中的“吻合”表示源码锚点与前序发现吻合，不表示本轮重放了反例探针或覆盖了所有运行时路径。

| 边界契约 / ASSUME | 本文抽查锚点与观察 | 判定及影响 |
|---|---|---|
| 插件配置目录与宿主目录完全一致 | 插件 `provider-profiles-extension.ts:21–23` 用 `??`；宿主 `packages/coding-agent/src/config.ts:508–533` 用真值判断并调用 `expandTildePath`；后者委托 `packages/coding-agent/src/utils/paths.ts:75–99` 的 `normalizePath`，展开 `~` 并转换 `file://`。 | **不成立，吻合 G-01**。空串、tilde、file URL 三类均不能声称已镜像宿主语义。 |
| 官方 zai API-key resolver 存在环境回退，故必须替换 | `packages/ai/src/auth/helpers.ts:18–28`：存储 key 优先，否则遍历 `ctx.env`，每次读取后检查 abort。与插件 `instantiator.ts:16–37` 的三分支对照。 | **成立，吻合**。仅证明 wrapper 去掉了该层回退，不证明更上游无环境来源。 |
| native Provider 注册后不会再被同名配置改造 | `packages/coding-agent/src/core/model-runtime.ts:246–267` 选择 native base 后，仍可调用 composer；`packages/coding-agent/src/core/provider-composer.ts:311–403,459–550` 注入配置 key、包装 auth/stream/getModels；`:129–155,207–244` 覆盖元数据。 | **不成立，吻合 G-02**。同名 `models.json` 不必被插件写入，也足以改变最终行为。 |
| 请求所见凭据只能来自实例存储或自身 profile key | `packages/coding-agent/src/main.ts:810–818` 将显式 `--api-key` 交给 runtime；`packages/coding-agent/src/core/model-runtime.ts:537–547` 安装 runtime key；`packages/coding-agent/src/core/runtime-credentials.ts:24–27` 优先返回 override。 | **不成立，吻合 G-03**。这是用户显式覆盖，不是插件自动借号；仍是无条件解析序的边界。 |
| 同槽存储 key 到 wrapper 前保持字面值 | `packages/coding-agent/src/core/auth-storage.ts:441–446` 调用 `resolveConfigValue`；`packages/coding-agent/src/core/resolve-config-value.ts:28–89,101–112,145–150` 解释变量引用，取 `env` 或 `process.env`。 | **不成立，吻合 G-04**。wrapper 不读 env 不能推出整条认证链不读 env。 |
| 按 provider id 访问的任意返回值都是合法 credential 或 undefined | `packages/coding-agent/src/core/auth-storage.ts:356–366,441–446` 使用普通对象并直接 `[provider]`；`packages/ai/src/auth/resolve.ts:87–109` 对真值但类型不匹配的 stored 值提前返回 undefined。 | **不成立，吻合 G-07**。合法名 `constructor` 可读出继承属性，阻断自身配置 key。 |
| 认证、模型与存储使用同一实例 id | `packages/ai/src/models.ts:534–566,577–600`：可用性按 provider 解析认证，模型请求取 `model.provider`，登录写 `credentials.modify(providerId, ...)`；`packages/ai/src/auth/resolve.ts:139–175` 的 OAuth 刷新亦按 providerId 修改；`runtime-credentials.ts:39–50` 的删除委托该槽。 | **条件成立，吻合**。不含上述值替换、继承属性与全局刷新反例；完整真实 OAuth 交互/登出/刷新未在本轮重跑。 |
| `allowNetwork: false` 的注册刷新没有异槽或持久化副作用 | `packages/coding-agent/src/core/model-runtime.ts:744–750` 无范围地启动 refresh；`:701–741,286–313` 重建与全局可用性刷新；`packages/ai/src/models.ts:398–429` 在网络开关判断前读取凭据并跑本地刷新。 | **不成立，吻合 G-05**。禁止网络不等于禁止本地读写，且不是仅刷新新实例。 |
| 本地刷新不会替其他 provider 写 ModelsStore | `packages/ai/src/providers/radius.ts:64–81` 在网络门禁之前发布旧目录；`packages/ai/src/models.ts:361–394` 将 `publication.persist` 送入 `modelsStore.write`。 | **不成立，吻合 G-06**。需要无已存目录且 OAuth 凭据带可迁移目录等触发前提，不是每次注册都写。 |
| API 返回即完成注册，插件 catch 可覆盖提交失败 | `packages/coding-agent/src/core/extensions/loader.ts:234–246,421–428` 的 loading 分支仅入队；`:204–210` 还有 pre-bind 队列；`packages/coding-agent/src/core/extensions/runner.ts:394–428` 对其 pending 注册分别捕获并发出错误。 | **不能据插件证明，吻合 R-C4**。宿主确有自身错误处理；本轮未穷尽 commit、回滚及所有队列组合，因此保留依赖，不宣称已观察隔离失败。 |
| available 快照与完整目录区分认证状态 | `packages/coding-agent/src/core/model-runtime.ts:277–313,332–371` 分别构造 all/available；`packages/ai/src/models.ts:534–553` 无 auth 返回空模型集。 | **PROVEN-依赖宿主，仅限 all/available 视图**：还须没有额外认证来源、刷新完成且未被旧快照暂态误导；不扩张到整个 `/model` UI。 |
| `/model` 所有显示路径都只使用 available | `packages/coding-agent/src/modes/interactive/components/model-selector.ts:161–181` 从 available 构造 allModels，却从 scopedModels 独立构造 scopedModelItems，scoped 分支不再认证过滤。 | **不成立，吻合 G-08**。缺凭据模型仍可能出现在 scoped UI；显示不代表请求通过认证。 |
| 真实扩展环境可解析官方工厂通道；重载/退出会正确清理 | 本轮核对 `provider-source.ts` 使用 `providers/all`；真实加载结果承接 `principles.md:143–149`、`test-results.md`，不重新启动 Pi。卸载语义依据 Q.A.11 仍未闭合。 | **导入冒烟保留原通过判定，未重跑；T-34 保持 BLOCKED**。不以源码推断代替真实进程生命周期。 |

注册是插件发起、宿主执行的因果边界，不能因间接副作用在宿主函数里就从 Q.I.5/P5 的审计范围中删除。反之，显式 CLI 覆盖与 scoped UI 是宿主的通用行为，不应误称为插件偷偷读了别人的 key。

## 三、组合论证 P.local.1–7

### P.local.1 — 实例身份唯一

C1 的前缀不变式给出已解析条目 name 合法、非内置且结构上唯一；C3 将 id 设为 name；C4 每输入只调用一次注册，局部同步异常不影响后项。链条在**插件调用边界**闭合。

但真实加载时“已返回”可能只表示入队；该事实不能推出已经产生恰一个最终 provider，更不能推出所有提交错误仍由插件逐项隔离并具名输出。根性质因此判 **PARTIAL**，未闭合处为 R-C4。没有观察到正常合法配置注册失败，也没有把该风险算成第九个反例缺陷。

### P.local.2 — 凭据隔离与显式解析序

C1 禁止 codex 配置 key；C3 的 API-key resolver 保证输入存储 key → 自身配置 key → undefined；重戳与宿主按 id 调度在正常凭据形态下连接了模型、认证与槽位。codex 的官方 OAuth 行为沿用官方对象，而非另写刷新器。

组合链的破口在 wrapper 前：同名 overlay 注入认证来源（G-02），显式 runtime key 优先（G-03），同槽 key 先被展开环境变量（G-04），以及 `constructor` 继承属性使宿主在尝试自身配置 key 前退出（G-07）。因此“wrapper 没有 `ctx.env`”只 discharge 局部子义务，不能 discharge P2 的全链路禁环境来源及固定优先序。

**判定：PARTIAL。** G-03 是显式用户选择；G-04 是同槽值解释而非跨槽读取；这些归属差别不抹去现有无条件文字与宿主行为的差距。

### P.local.3 — 模型归属重戳

C3 每次查询逐模型重戳，输入不变且其他字段相等，故实例直接输出满足 P3。没有同名合成时，runtime 的 native base 分支可直接保存此 Provider；all 与 available 的筛选本身不重写元数据。

但 `composeModelProvider` 可在同名配置存在时覆盖成本、窗口、输出上限、reasoning、compat 等模型字段。此时即使 `provider === name` 继续成立，“其余字段等于官方条目”也不成立。

**判定：PARTIAL；缺口 G-02。** 不把无 overlay 的条件证明推广到用户现有 `models.json` 的任意配置。

### P.local.4 — 官方语义继承与 id 绑定闭包剔除

实例构造处八字段封闭，stream 引用、登录引用及 codex auth 引用按契约共享；原工厂 `refreshModels`/`filterModels` 不进入实例。三种工厂的 id 无关前提承接前序逐字段论证，本轮未重新穷尽其实现。

宿主 composer 返回的是另一个 provider：stream/auth/getModels 可变成包装函数，返回对象还声明 `refreshModels`/`filterModels` 等字段。对当前无这些能力的实例，它们可为 undefined；这里的反例是**引用与字段白名单不再原样成立**，不是声称观察到了被剔除的旧 id 闭包执行。

**判定：PARTIAL；缺口 G-02。** C3 的封闭对象构造已经证明，宿主保形前提则被反例否定。

### P.local.5 — 不干扰

C1 防止以内置 id 注册；插件本身只读取 profile 文件、不直接读写 auth 或 models 文件；构造不修改 base；源码中没有直接文件写操作。这些局部事实成立。

但每次 native 注册会启动不限 provider 范围的宿主刷新，即使 `allowNetwork: false` 也会读取内置凭据槽（G-05）；在 radius 迁移前提成立时还会持久化该内置 provider 的模型目录（G-06）。不需要实例复制 `refreshModels`，也不需要有网络调用，便能形成这条因果链。

**判定：PARTIAL；缺口 G-05、G-06。** 同名 overlay 被读取不是插件写了 `models.json`；不得混淆 G-02 与“改写 models.json 文件”的反例。

### P.local.6 — 配置驱动与失败可见

给定正确路径，文件层整体异常先于注册；条目检查、构造和同步注册三类错误具名聚合，其余继续。添加合法条目不需要修改产品代码。当前工厂已修复 T-12 的构造阶段整体中断。

G-01 使部分合法宿主目录配置落到不同路径；错误路径不存在时甚至按 ENOENT 静默成为空配置。R-C4 则使 commit 错误是否具名可见、是否隔离不再由插件同步返回保证。坏 JSON 的零注册只约束本次加载，不承诺撤销旧实例。

**判定：PARTIAL；缺口 G-01，另有 R-C4 依赖。** T-34 未执行，不把重载旧状态当成已清理。

### P.local.7 — 缺凭据即不可用

正常组合链为：自身 credential 缺失且自身配置 key 缺失 → wrapper 返回 undefined → 宿主 auth 检查失败 → all 仍可含模型、available 不含该实例模型。该已追踪子结论记作 **PROVEN-依赖宿主，严格限 all/available 视图**；前提还包括无同名 overlay/显式 override、宿主刷新已完成。它既不是 `/model` 全 UI 的证明，也不是所有请求入口均不能显式覆盖认证的证明。

P7 保留且只计以下**三个**根缺口：

1. **G-02：overlay 补位。** 无自身 key 的实例可被同名 `models.json` 的配置/env key 激活，并以该来源认证。
2. **G-03：显式请求身份覆盖。** 用户 `--api-key` 可使选中的实例使用显式提供的另一 key。它不是静默回退，但 P7 原文的“任何执行路径”没有排除此路径。
3. **G-08：scoped UI 未再次认证过滤。** 登出后 available 已空，scopedModels 仍能产生 filteredModels 并显示该实例模型；请求级 auth 仍会拒绝真正无凭据的调用。

**判定：PARTIAL（3）。** G-04 的同槽环境值解释归 P2，本项三缺口不重复计数；G-07 是“有自身配置 key 却不可用”，不是“无 key 却可用”，也不塞入 P7 的三项。

## 四、失败路径与状态残留

| 路径 | 插件可证明的结果 | 不能据此承诺的状态 / 已知残留 |
|---|---|---|
| 顶层导入失败 | 工厂未进入，没有本次插件注册。 | 插件自身无法补充条目诊断；宿主加载诊断承担整体可见性。既有实例是否存在取决于进程历史。 |
| 文件不存在 | 得到空配置，零注册输入。 | G-01 下“没找到正确文件”会伪装成正常空配置。 |
| 文件不可读、坏 JSON、顶层非对象 | 整体 ConfigError，后续阶段不执行。 | 不回滚此前加载/此前运行已注册的 provider。 |
| 单条 shape/name/provider/key 错误 | 具名错误；此项不构造，其余继续。 | 文本重复键已被 JSON.parse 覆盖，无法再报告前一个同名文本条目。 |
| C2/C3 某项构造抛错 | 当前工厂捕获为该项错误，后项继续；未构造项不入注册输入。 | 不把历史 T-12 的失败继续列为当前未修缺陷。 |
| C4 调用同步抛错 | 记 failed 并继续后项。 | API 若先改变状态再抛错，插件无回滚；本文未观察此种宿主失败，保留 R-C4。 |
| loading 入队后 commit 才失败 | 插件的调用栈已返回，不能捕获该后续错误。 | registered 是同步接受清单，不是事务提交凭证；宿主 pending 队列已有 catch，但所有提交语义未在本轮闭合。 |
| resolve 入口已 abort | wrapper 拒绝；不返回 key，无插件持久化操作。 | 不主张返回之后再取消能追回已经给出的认证结果。 |
| 确实缺 credential 与 profile key | 直接 wrapper 返回 undefined。 | overlay/runtime key 可在之前补位；不能只测 wrapper 就宣布全链路缺凭据。 |
| 存储有真值但远端无效的 key | 按优先序选 stored，不尝试用 profile key 规避远端失败。 | 请求与远端失败语义归宿主；插件没有自动换号或失败转移。 |
| 存储/官方 OAuth 流程抛错 | wrapper 不建立另一套补救认证来源；OAuth 仍走官方行为。 | 本轮未执行真实 OAuth/网络，不扩大前序未覆盖部分。 |
| `constructor` + 自身 profile key | 局部校验和实例构造成功。 | 宿主读出继承函数并提前认定不能认证，配置 key 未尝试；实例模型不可用（G-07）。 |
| 登出后仍有自身配置 key | 仍可按自身配置 key 认证，是既定合法回退。 | 不是登出后静默借用其他账号；与无任何凭据的 G-08 区分。 |
| 登出后无任何认证来源 | 稳定 available 快照排除实例；请求认证继续拦截。 | scoped UI 仍能保留并显示模型（G-08）；UI 残留不证明请求泄露 key。 |
| 注册触发异步全局 refresh | 注册启动 `void refresh({ allowNetwork: false })`；插件不 await 完成。 | 异槽读取、条件性 ModelsStore 写入及快照暂态是宿主副作用；不能从“注册返回”推导全部刷新已成功或全无副作用。 |
| disable/reload/exit/new-process | 插件没有自动 unregister；文档允许“存活至退出”的边界。 | **T-34 BLOCKED**；删除/改名/坏 JSON 重载与退出清理的实际行为没有本轮生命周期证据。 |

## 五、结论表

本表判定对象是原 `architecture.md` 的根性质，而不是把局部函数后置条件冒充根性质。P1 的 PARTIAL 仅标记真实提交依赖未闭合，不代表已发现正常注册失败。

| P | 判定 | 已成立的依据 | 缺口编号 / 未闭合依赖 |
|---|---|---|---|
| P.local.1 | **PARTIAL** | C1 分支分类、C3 id 重绑、C4 每项一次同步调用。 | 无已复现的编号缺陷；R-C4（入队不等于提交，隔离依赖宿主）。 |
| P.local.2 | **PARTIAL** | wrapper 三分支、codex 字段限制、正常按 id 的认证与存储路径。 | G-02、G-03、G-04、G-07。 |
| P.local.3 | **PARTIAL** | `restampModels` 同序重戳、不变输入、其他字段相等。 | G-02（最终宿主元数据可被覆盖）。 |
| P.local.4 | **PARTIAL** | C3 八字段、官方引用共享、原 id 闭包剔除。 | G-02（合成后引用与白名单不保形）。 |
| P.local.5 | **PARTIAL** | 不用内置 id 注册、不改 base、插件无直接文件写入。 | G-05（异槽读取）、G-06（异 provider 持久化）。 |
| P.local.6 | **PARTIAL** | 正确路径下文件/条目分级，构造失败隔离，当前 T-12 修复。 | G-01；另有 R-C4，重载生命周期 T-34 未验证。 |
| P.local.7 | **PARTIAL（3）** | 正常无来源时失败认证；PROVEN-依赖宿主子结论仅限 all/available。 | G-02、G-03、G-08，恰三项，不以 UI 证据替代请求认证证据。 |

八项反例不能简单相加成八个产品代码缺陷：其中有插件待修缺陷，也有宿主通用语义与集成副作用。应保持事实、归属、是否需要改变 P 的产品选择彼此分离，本文不替实现者修改代码或替用户收窄承诺。

## 六、缺陷与边界清单

### G-01 — 配置路径未完整镜像宿主（插件层待修）

**复现前提**：`PI_CODING_AGENT_DIR` 为 `""`、`~/...` 或 `file://...`。

**轨迹**：空串在宿主 `if (envDir)` 中走默认目录，在插件 `??` 中被接受并产生相对配置路径；tilde/file URL 在宿主经 `normalizePath` 展开，在插件只被 `join` 当路径字符串拼接。配置可能被漏读或从不同位置读入；不存在时无配置错误，直接成为空配置。

**影响**：P6 的配置入口契约；不能继续把 `profileConfigPath` 描述为完整镜像。**证据**：前序零网络内存探针，本文源码抽查吻合；未重跑三种输入。

### G-02 — 同名 `models.json` overlay 穿透实例隔离（插件层待修）

**复现前提**：profile 实例与既有 `models.json` provider 条目同名；无须修改或覆盖内置 id。

**轨迹**：native 注册后 runtime 以实例为 base 调用 `composeModelProvider`；无 stored 时，同名配置 key 先被解析，再作为 credential 传给继承 resolver，优先于 wrapper 的自身 profile key。配置值可以来自环境引用；因此无自身 key 的实例也可认证并进入 available。合成器还覆盖模型字段并包装 stream/auth/getModels，破坏最终“完全沿用元数据/同一函数引用/八字段对象”的承诺。

**影响**：P2、P3、P4、P7。**归属**：宿主合成本身是合法功能；插件面对既有配置未封闭隔离边界，是插件层待修的集成缺陷。**证据**：前序零网络内存探针；本文合成、key 注入、元数据及返回对象锚点抽查吻合。没有把“读取 overlay”误记为插件改写 models.json 文件。

### G-03 — 显式 `--api-key` 优先（宿主边界记录）

**复现前提**：用户选中某实例模型，同时显式提供不同的非空 CLI key。

**轨迹**：CLI → `setRuntimeApiKey(model.provider, key)` → `RuntimeCredentials.read` 优先返回 override → wrapper 走传入 credential 分支；实例自己的存储/profile key 不再优先。

**影响**：P2 的无条件来源顺序及 P7 的“任何执行路径”。**归属**：用户显式动作，非插件自动换号或静默 env 回退。是否允许这项宿主覆盖须由产品契约决定，不能在正确性报告里悄悄增设豁免。**证据**：前序内存探针；本文 CLI 到 runtime adapter 锚点吻合，未重启真实 CLI。

### G-04 — 同槽 stored key 先展开环境变量（宿主边界记录）

**复现前提**：实例自己的 AuthStorage 槽中 API-key 字符串含环境引用，且有相应环境值。

**轨迹**：`AuthStorage.read(name)` → `resolveConfigValue` 展开 → wrapper 收到已经解析的 key。wrapper 没有调用 `ctx.env` 仍不意味着全链路未读环境。

**影响**：P2 的禁止环境来源；不是“读取了另一个 provider 槽”的同义说法。**证据**：前序零网络内存探针；本文 storage 与变量解析锚点吻合，未重跑环境场景。

### G-05 — native 注册触发内置凭据槽读取（宿主边界记录）

**复现前提**：注册实例，宿主还有内置 providers；观察本次注册引发的刷新而非与其无关的启动本底。

**轨迹**：`registerNativeProvider` → 无 providers 限定的 `refresh({ allowNetwork: false })` → 本地刷新及全局可用性检查 → 读取内置 provider 的逻辑槽位。

**影响**：P5 的“除本实例外不读取凭据”。**证据**：前序内存探针已观察逻辑槽位访问；本文链路吻合。没有把“底层读取整份 auth.json”本身等同于访问每个逻辑槽；此处有显式逐 provider 的认证/刷新调用。

### G-06 — radius 旧模型目录迁移产生异 provider 持久化（宿主边界记录）

**复现前提**：同一全局本地刷新中，radius 没有已存 ModelsStore 目录，但 OAuth credential 携带可恢复的旧模型目录；刷新尚未被取消/失效。

**轨迹**：radius 本地 refresh → `getRadiusModels` 得到旧目录 → `context.publish({ persist: ... })` → `modelsStore.write("radius", ...)`；这一分支在 `if (!context.allowNetwork ...) return` 之前。

**影响**：P5 的间接写入/不干扰承诺；禁止网络并不禁止迁移持久化。**证据**：前序零网络内存探针观察到其他 provider 的 ModelsStore 写调用；本文抽查 publish→write 与网络门禁顺序吻合。`getRadiusModels` 的内部目录解码和真实磁盘适配器本轮未再追踪，保留前序判定；不把内存写探针夸大成“本轮已写某真实磁盘文件”。这里的“旧目录”指旧模型 catalog，不是擅自扫描外部凭据目录。

### G-07 — `constructor` 名称触发继承属性凭据（插件层待修）

**复现前提**：合法配置名 `constructor`，provider 为 zai，具有自己的 profile `apiKey`；无同名 overlay/runtime override；`AuthStorage.inMemory({})` 为空。

**轨迹**：C1 允许该名字 → 实例注册 → `read("constructor")` 对普通对象直接索引，得到继承的 `Object` 构造函数 → 该值为真且不是合法 credential 类型 → `resolveProviderAuth` 提前返回 undefined → wrapper 及其 profile key 分支均未调用 → 该实例的 getAvailable 结果为空。

**影响**：P2 在真实宿主边界的破口，不是只有“恶意畸形输入”才触发；用户给的是允许的名字与合法自身 key。**归属**：根因在宿主存储对象访问，插件当前允许的名字域与宿主可用槽位域不兼容，按本报告任务要求列为插件层待修缺陷；不授权修改官方源码。**证据**：前序零网络内存探针；本文空普通对象、无 own-property 检查、truthy stored 提前出口均吻合，未重跑探针。

### G-08 — 登出后 scoped `/model` 仍显示（宿主边界记录）

**复现前提**：实例无剩余配置 key、overlay 或 runtime key；登出后 available 快照已空，既有 scopedModels 仍包含该模型，选择器在 scoped 模式。

**轨迹**：`loadModelsFromSnapshot` 将 available 作为 allModels，却另将 scopedModels 经 `getModel` 或保留原项映射为 scopedModelItems；该路径不按认证过滤，直接形成 activeModels/filteredModels。于是 available 不含模型与 UI 仍显示模型可以同时成立。

**影响**：P7 的 `/model` 显示义务。**归属**：宿主对所有 provider 通用的 scoped UI 行为，不是本插件独有；请求级认证仍拦截无凭据调用，不推导成出站借号或凭据泄露。**证据**：前序零网络内存探针；本文 selector 分支吻合，未启动真实交互 UI。

### R-C4 — deferred registration（保留风险，不计已观察失败）

loading 期间插件调用只排队，提交时刻已离开 `registerInstances` 的 `try/catch`。宿主 runner 的 pending 注册循环自身有逐项 catch 和 `emitError`，因此不能从“插件捕获不到”直接推出“实际宿主后项必然被阻断”。当前能确定的是：**C4 的根条目隔离与无残留依赖宿主提交语义，插件同步成功清单不足以证明它们**。前序没有把它作为已观察失败；本文保持该判定。需真实提交故障/先改状态后失败的绑定证据才能进一步闭合，不拿合成同步抛错测试代替。

### T-34 — BLOCKED：真实进程生命周期

`test-results.md` 保留了 T-34 `test.skip`；fake Pi 不具备真实 disable/reload/exit/new-process 生命周期。前序及本文均未执行 T-34，不能宣布卸载自动注销、删除配置即时清理、坏 JSON 重载回滚或新进程状态已验证。允许实例存活至退出是既有可接受边界，不是已经观测过退出清理的证据。

### 归属、证据与抽查范围声明

- **唯一仓库改动**：本文件。产品代码、五份既有文档、测试、用户配置及凭据文件均未修改；运行器要求的最终摘要另存指定输出 artifact，不替代本文件。
- **推导归属**：局部逐路径推导与零网络内存反例来自 **bcb59dbd 进展报告，本文做了锚点抽查**。本文没有取得其原始探针日志，不虚构命令、断言输出或测试次数；未抽查的完整工厂语义、真实 OAuth、旧目录解码及原始探针输出保持原判定并注明范围。
- **材料范围**：通读 `principles.md`、`architecture.md`、`detailed.md`、`test-plan.md`、`test-results.md` 与七个产品源文件；前五份材料不是本文的执行日志。尤其 `test-results.md` 的最新 48 通过、1 跳过及既有类型诊断属于前序执行记录，本文没有重跑 Vitest。历史冒烟使用 dummy key 的真实网络结果也不冒称为本文或前序内存探针的零网络结果。
- **锚点预算**：宿主定位/抽查共 9 次工具调用（含一次候选路径定位失败与一次文件名定位）；每个宿主源码文件最多被定位/读取 3 次。加上 5 次材料通读和 1 次工作区基线检查，共 15 次输入材料检查；报告写入与报告自身校验不作为新增源码抽查。未做无界搜索或追加测试追踪。
- **定位差错而非发现分歧**：一次搜索中的 `core/model-runtime-credentials.ts`、`utils/path-utils.ts` 不存在；随后定位到 `core/runtime-credentials.ts`、`utils/paths.ts`。这不构成产品缺陷，也没有导致遗漏关键边界。**抽查不符项：无**。既有 detailed 文档的导入表述滞后及路径“镜像”过强已明确记录，未据此把前序已核验发现改判为相反结论。
- **验收边界**：本轮只做源码锚点核对与 Markdown 报告结构/引用检查，不执行构建、产品测试、真实登录、网络或生命周期操作。八项缺口、R-C4、T-34 均未因写报告而修复；它们是交付后的残余风险。

## 修复后记（设计所有者，2026-09-22，本文撰写者之外追加）

报告交付后，设计所有者按 QPDI Discover 对插件层待修缺陷执行了 contract redesign 与 I 层修复，并复跑全部验证：

- **G-01 已闭合**：`profileConfigPath` 改为复用宿主导出的 `getAgentDir()`（coding-agent 公开 index 导出），env 覆盖、空串、tilde/file:// 语义完全委托宿主；vitest 经 `test/host-exports.ts` 别名路由到同一源码函数（非 stub）。
- **G-02 已闭合（P1/P5 contract redesign）**：C1 denylist 扩展至 `agentDir/models.json` 的 provider 键（只读、容错解析）；同名条目被拒绝并可见报错。architecture.md P.local.1/P.local.5 已同步修订。
- **G-07 已闭合**：C1 拒绝 `Object.getOwnPropertyNames(Object.prototype)` 精确匹配的保留键（有效集合中实际命中的是 `constructor`）。
- **验证**：插件测试 56 项 = 55 通过 + 1 阻塞跳过（T-34）；真实 Pi 隔离冒烟四类拒绝（坏名、内置冲突、保留键、models.json 冲突）全部生效，好条目照常注册。
- **维持为宿主边界（未修改）**：G-03、G-04、G-05、G-06、G-08、R-C4、T-34。P2/P5/P7 相应判定从"缺口"收窄为"已文档化的宿主边界"；P1/P3/P4/P6 的插件层缺口来源（G-01/G-02/G-07）已消除。


## 审计后变更范围声明（设计所有者，2026-09-22 追加）

本报告的逐函数推导与结论表锚定 2026-09-22 上午的实现修订（G-01/G-02/G-07 修复轮之后）。此后经用户裁决又发生两轮契约变更，**晚于本审计范围**：

1. **来源泛化**：`provider-source.ts` 重写为动态分类（`builtinProviders()` 遍历 − refreshModels 携带者 + oauth 形状读取 + 进程内缓存）；`config-entry.ts` 的 provider 校验改为 ValidationContext 动态集合（不可识别一律拒绝）。
2. **`/add-login` 命令层**（`commands.ts`/`config-writer.ts`/`resolveEnvTemplate`）与补全的位置状态模型。

这些变更的验证依据为：当时插件测试套（69 项：68 通过 + 1 阻塞跳过）与真实 Pi 隔离冒烟（未知来源 declined、动态补全、即时注册）；其独立 Hoare 复审未在本报告范围内执行，如需可将 C2 分类不变量（缓存只读、refreshModels 排除的完全性）与 C5 写入原子性纳入下一轮独立推理。

## 当前审计适用范围（2026-09-22）

本文件的主体 Hoare 推导审计的是早期三来源/全键冲突实现；后来对 G-01/G-02/G-07、动态来源分类、C5 命令和受控 Copilot filter forwarding 的修改没有重新接受独立 Hoare 推理。当前可承担的证据是最新 68/1 聚焦测试、`npm run check` 和真实 Pi 隔离/用户配置冒烟；当前 QPD 规范以 `principles.md`、`architecture.md`、`detailed.md` 为准。历史 PARTIAL/G 编号保留为发现路径，不自动描述现行行为。

## G-02 同名规则勘误（用户纠正后，2026-09-22）

先前修复后记声称“models.json 中任何同名 provider 键均须拒绝”，**已被本轮取代**，不能再作为现行判据。`composeModelProvider` 将同名 `modelOverrides` 应用于模型目录，认证仍由独立的 `composeApiKeyAuth`/`composeOAuthAuth` 合成；仅有 `modelOverrides`（无模型级 `headers`）的条目不注入新凭据来源，因此可以与具名实例共存。相反，provider 级字段与模型级 `headers` 可影响认证、路由、目录或请求头，仍需阻断。C1 当前读取 `models.json` 内容后只将**危险条目**加入冲突集；并未对整个 `models.json` 采用无条件 denylist。

本轮证据：当时单测记录为 69 通过/1 跳过；当前套件计数以 `test-results.md` 顶部的 68 通过/1 跳过为准；隔离 Pi 的 `safe-zai` 同名 `modelOverrides.contextWindow=543210` 真正显示 543.2K，`unsafe-zai` 同名 `apiKey` 被具名拒绝；真实用户配置里仅有 `modelOverrides.contextWindow` 的 codex-001/002/999 已注册且显示覆盖后的窗口值。旧的 G-02 内存反例仍成立，但其前提应收窄为**危险配置内容同名**，不得泛化为“任意同名即冲突”。本轮未重做独立全局 Hoare 推理；其余宿主边界判定不受此勘误改变。
