# goal.md — my-settings 重写后独立逐函数验证（RUN 2026-10-15）

判据源：用户固定判据（extern-model.md §Scope 同文）；语义基准 arch/prototype.md（用户已确认）。
范围：根目录 13 个生产 TS 文件（manifest.json 39 函数 + 44 外部 + 150 skipped）；`_cca_analysis-pre-repair/` 为历史证据，不作为当前源码事实引用。

## 一、架构与数据流

```
pi (宿主)
 └─ mySettings(pi)  [extension.ts:L11 默认导出, index.ts 再导出]
     ├─ registerMySettingsService(pi.events, resolver闭包, getAgentDir(), withFileMutationQueue)
     │    └─ bus.on("my-settings:service:v1", handler)   [settings-service.ts:L21]
     ├─ pi.on(session_start/session_tree, bind) / pi.on(session_shutdown, 清 active)
     └─ bind: active = {context, sessionId}; pi.events.emit("my-settings:ready:v1", ready)

消费方
 └─ createMySettingsClient(bus, owner)  [client.ts:L14]
     └─ 返回 query / saveGlobalOnly / saveLocalOnly / saveGlobalAndSession / saveLocalAndSession / saveSession
         └─ invoke(op): emit(request{session, sessionId, operation, accept})
              ├─ handler(同步派发窗口内): 校验 payload → resolveSession(→extension resolver 闭包)
              │    → parseSettingsOperation → executeSettingsQuery / executeSettingsSave
              │    → accept(promise)   [client.ts:L36 accept；L39 catch 兜晚到/重复 accept]
              └─ 无 handler 响应 ⇒ SERVICE_UNAVAILABLE（结构化，不抛）

查询管线 [settings-query.ts:executeSettingsQuery]
  settingsFilePath(globalRoot, globalPath) ─ 失败⇒结构化返回
  scope=global ⇒ 不构造 localFile（不读 local）；否则 settingsFilePath(join(session.cwd,".pi"), localPath)
  copySettings(defaults) 校验 ⇒ isCurrent 门 → Promise.all(loadFile(global), loadFile(local))
  → scope=session: getBranch() → readSessionPatches（坏条目逐条诊断+跳过）→ pickValidFields 逐补丁叠加
  → merged = defaults < global < local < session overlay → 按默认键投影 → copySettings 分离快照

保存管线 [settings-save.ts:executeSettingsSave]
  save-session: 仅 appendSessionSettings（日志只记 {values}）
  Only 变体: filePathFor → writeSettingsFile（原子写），失败⇒结构化返回，永不写日志
  AndSession: 文件步骤失败 ⇒ 诊断+吞掉 → 日志步骤决定整体结果
  writeSettingsFile: copySettings(values) → mkdir → realpath 定位 → 队列内 {isCurrent 门 → 读原文件
  （坏原文件⇒失败不覆盖）→ {...existing, ...patch} → tmp(wx)+rename 原子提交 → 未提交则 unlink 清理}

错误模型 [settings-error.ts]：settingsFailure（全定义域不抛，C 批证明）/ reportSettingsError（console.error，
自身不抛）；全仓 39 函数 0 显式 throw / 0 Promise.reject（六批 grep 验证）；PARTIAL_SAVE 不存在于
protocol.ts:35 错误码联合及一切路径（F 批锚点核验）。
```

## 二、内存分配/释放/转移/解引用（JS 域）

无手工内存管理；所有权与生命周期边界如下（逐条可证伪）：
- copySettings [json-settings.ts:L4]：唯一"深快照"出口。内部 holder(Object.create(null)) + ancestors Set + pending 显式栈（无递归）；出口再经 `JSON.parse(JSON.stringify(holder.root))` 二次分离（:79）。ok 结果 ⇒ 纯 JSON 快照，与输入对象零共享（D 批定理）。
- client 闭包 [client.ts]：`session/sessionId/initialFailure` 构造期一次写入后只读；`response/closed` 为 invoke 每次调用私有——`response` 仅在同步 emit 窗口内由 accept 写入一次（selected 守卫 :38），`closed=true` 于 finally；accept 闭包随 request 转移给 service，仅在派发窗口被调用，晚到/重复 accept 被 closed+selected 折叠，不泄漏未处理 rejection。
- service 侧：request payload 由 client 创建；handler 不持有跨事件状态（每次 emit 独立）；accept 引用只在当次处理中存活。
- writeSettingsFile：action 闭包每次调用新建，交宿主队列，settle 后释放；temporary 文件未提交必 unlink（:69-77）。
- mySettings `active`：bind 写入、shutdown 清空、resolver 读取——单写者（宿主事件循环串行），经 `active === owner` + sessionId 活读防会话漂移（B 批：sessionManager.sessionId 原地变更语义）。
- ready 对象：bind 创建后 emit 转移给宿主监听者，插件侧不再持有。

## 三、入口识别（34 入口 + PRE 实录）

机器可读清单见 entries.json；PRE 为"合法参数域"实录（JS 对应指针/长度/范围/所有权）：
- mySettings(pi)：PRE = pi 具备 events{on,emit}/on/appendEntry 的 ExtensionAPI 形状；违规由外层 try 折为诊断+惰性插件（fail-closed）。
- createMySettingsClient(bus, owner)：PRE = bus.emit/on 同步派发合同（event-bus.ts 实证）；owner = {session: object, sessionId: string}，违规⇒构造期结构化 INVALID_REQUEST。
- client 六方法(save: SettingsSave / query: SettingsQuery 类型域)；accept/catch：service 回调驱动，无输入 PRE（payload 校验在 handler）。
- resolver(L16)/bind/shutdown(L82)：宿主/service 回调驱动；bind 前提 = service 注册成功（extension.ts:63-66）。
- registerMySettingsService(bus, resolveSession, globalRoot, queue)：PRE = bus.on 合同 + resolveSession 全定义域不抛（extension resolver 满足）+ globalRoot:string + queue ≡ withFileMutationQueue；单次注册为调用方 PRE（宿主加载一次）。
- executeSettingsQuery(query, session, globalRoot)：PRE-A = parseSettingsOperation ok 产物 + conforming session（cwd:string + 三端口合同）；PRE-B（独立导出下界）= query 非 null 对象 + 端口合同，违规⇒同步 TypeError→rejection→仍 settle→client accept 折为结构化失败（记 PRE 边界，非偏差）。
- executeSettingsSave(op, save, session, globalRoot, queue)：同判例（F 批 PRE-A/PRE-B 实录）。
- parseSettingsOperation/readDataFields/copySettings：任意值定义域，无条件不抛。
- pickValidFields(source, defaults, raw)：PRE = defaults/raw 为 Settings（仓内由 copySettings 产物保证）；kindOf 硬 PRE = 值不得为 revoked-Proxy 可达（仓内域满足，pickValidFields 外层 try 兜底）。
- settingsFilePath(root, configured)：root:string；configured?: string|null。
- readSettingsFile(path)/writeSettingsFile(path, values, queue, isCurrent)：path:string；writeSettingsFile 额外 PRE = queue 合同 + isCurrent 不抛端口。
- appendSessionSettings(session, values)/readSessionPatches(entries)：conforming session / SettingsEntry[]。
- settingsFailure/reportSettingsError：任意值定义域。
- queue-action(L51)/dispose(L57)/on(L21)/isCurrent/getBranch/appendEntry 端口：队列/消费者/总线回调驱动。

## 四、核心数据结构不变量

- `Settings`：plain JSON 对象——无 getter/setter、无 toJSON、无环、无数组洞、number 有限、array length ∈ [0, 2^32-1] 且 isSafeInteger（copySettings 全类目枚举，D 批定理：ok ⇒ 不变量成立）。
- `SettingsOutcome<T>`/`SettingsResult`：ok:true ⇒ value 全形（client.ts:58 永不见 {ok:true, values:undefined}——C/D/E/F 链式证明）；ok:false ⇒ {code∈4 值联合, message:string}。
- `SettingsSaveOperation`：恰 5 个白名单串（SAVE_OPS Set + parse 校验）。
- SessionPatch[]：source 标签 + values 快照，oldest→newest 保序（readSessionPatches :39-53）。
- 日志条目数据 = `{values}` only（SettingsLog，appendSessionSettings :23-25）。
- 队列不变量：同目标绝对路径 RMW 串行（宿主 file-mutation-queue），tmp+rename 提交原子，wx 防碰撞。

## 五、共享状态与同步盘点

- mySettings `active`（模块闭包）：宿主事件驱动单写者；读取方 resolver/isCurrent 以身份+ID 双校验消费。无跨会话全局。
- createMySettingsClient 闭包三变量：构造期定身，此后只读。
- invoke `response/closed`：单请求私有，同步写窗口 + finally 关闭。
- 文件系统：以宿主队列为唯一同路径串行化机制；原子写协议见 §一。
- 端口纪律：所有 isCurrent 门→使用保持同步（无 yield 点），E/F 批逐点核实；残余 TOCTOU 窗口（writeSettingsFile :63→:66、双 realpath）已如实记录（open-questions.md）。
- 除此之外无共享可变状态；无锁需求（JS 单线程 + 队列串行化）。

## 六、结论

39/39 函数完成逐函数建模（fn-*.md 非空齐全，SP 段齐备）；owner 判据（逐函数自身不向外 throw/reject；失败仅结构化 error 或安全诊断）全仓满足，未发现偏差；原型语义逐条对照通过（4 处已锚点的非违例分歧 + 文档缺口见 open-questions.md）。宿主灾难性 OOM/终止与环境域 unknown 单列 open-questions.md，不计入 JS 异常合同。
