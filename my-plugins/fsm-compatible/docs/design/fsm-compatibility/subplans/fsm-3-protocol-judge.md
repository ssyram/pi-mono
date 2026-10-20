# fsm-3-protocol-judge：原始证据、OC wire 与独立 judge

状态：补齐原审查 B5 的字段级合同；尚未进入本单元编码。父合同：architecture P5/P6/I5/I6/I7，detailed-design §5.3/5.4。fsm-2 已有本地通道实现和直接测试；根完整 ready/安装仍未完成，不因通道测试通过放行缺失职责。

## 1. 目的与数据真源

FSM 原 consumer 需要真实执行树与完整执行证据，以及一次真实独立 judge turn 的严格 OC envelope。插件不重写判定器、repair/retry，不把 SDK abort 用作成功结束，不给 judge 注册 execution binding、FSM Client、dispatch、Stop 或 fsm-compatible。

输入源为实际 SessionManager.getBranch/getEntries/header，以及本 session 的 message/agent lifecycle、provider response 事件。getBranch 取当前真实叶子的祖先链；不能用 buildContextEntries/buildSessionProjection/messages 代替原始史，这些会按 compaction/context edit 删除或替换模型可见贡献。getEntries 留给明确的恢复/分支查询，不能把其它分支混进当前证据。

一手 consumer：use-fsm crates/server/src/evidence.rs:2525-2685（roster/live-work）、:1748-1797（逐 envelope 原样序列化快照）；agent_cli.rs:75-88、580-617、662-690（工具/请求）、1744-1928（终结与结构化结果）、2044-2076/2130-2174（create/abort）。工具参数来源为 haokun-code 当前 read/grep/glob/edit/shell/prompt/webfetch/websearch 的 Parameters，不沿用旧 zod 版本。

## 2. 类型与范围

- ExecutionRecord：PersistedBinding、title、updatedAt、lifecycle、rawBranch、sessionFile；原首单元身份不得覆盖。store 只归一个 root owner，索引私有，不用全局 Map。judge 存在独立索引，不在 execution 树中。
- Lifecycle：starting/running/settling/retrying/idle/failed/aborted/unavailable。message/event数值时间必须是非负安全整数毫秒。SessionHeader/SessionEntryBase.timestamp实际为ISO字符串：先Date.parse→验证非负安全整数→用new Date(ms).toISOString()===原字符串确认当前SDK的canonical ISO形状/真实日历值；非法字符串/数值拒绝，不用当前时间补造历史。rawBranch/header保留原字符串，转换另存归一化值。
- OcSession：id、parentID:string|null、title、time:{created,updated}；id 是真实 Pi SID，不是 SA runId。created使用归一化header时间，updated取归一化entry与实际数值lifecycle时间的max。后续created/updated/completed/tool start/end及max运算只使用上述归一化整数。message.timestamp存在但非法时拒绝；仅确实不存在时可用归一化owning entry时间。
- OcMessage：{info,parts}。info 与每个 part 的 session/message identity 同源；message ID = `msg_` + owning entry.id，part ID = `prt_` + entry.id + `_` + 实际 content index。judge 用自身真实 entry ID，同 sid repair 不复用上一 turn 的 capture。
- JudgeTurn：request/system/schema/allowedTools、实际用户及 assistant entry、toolCallId→实际结果、capture 记录列表、终结错误、provider provenance、start/end、cancel controller。私有可变，HTTP/模型不可设置 ready/capture/provenance。
- ProviderProvenance 只保存 api、HTTP status 与明确解析的非秘密 error 分类/stop reason；不保存 headers、原 provider payload 或错误 body。未知语义保留 unknown，而非推断 API retryability。

## 3. HTTP 路由与认证

监听仅 127.0.0.1，随机端口和 owner-owned Basic password；用户名 `opencode`，与原 HTTP consumer 的 Basic 合同一致。秘密只送根拥有的 FSM Client/hook 环境，不改 process.env，不写 binding/普通日志。先验证 auth，再处理 method/path/body；比较使用固定长度 digest 与 timingSafeEqual。桥地址必须来自实际 listening 地址。

| 方法/路径 | 请求 | 成功 | 不成功 |
|---|---|---|---|
| GET /session | 无 | execution 和 retained judge 的 metadata 数组，真实 parentID | 根失效/记录不可用 503 |
| GET /session/status | 无 | 每个登记 SID 的 `{type:"busy"|"retry"|"idle"}` | 任一必要事实 unavailable：503，不省略该 SID |
| GET /session/:sid | 无 | 实际 OcSession | 未知404，失效503 |
| GET /session/:sid/children | 无 | 仅直接 execution 孩子；judge 无孩子返回 [] | 未知404，不以空数组掩盖失联 |
| GET /session/:sid/message | 无 | 当前真实分支 oldest→newest envelopes | 未知404，坏关联/时间503 |
| POST /session | `{title:"fsm-gate"}`，无parent | 实际独立 SDK judge metadata，含非空id | 非judge创建400；容量/模型未配置/实际创建失败503 |
| POST /session/:sid/message | §5格式；目标须为judge | 一次真实完整 turn 的 `{info,parts}` | shape400，未知404，执行目标403，并发同judge409，资源/transport失败503 |
| POST /session/:sid/abort | 无body | JSON true，仅实际idle确认后 | 未知404，未确认中止503；不删除session |
| POST /session/:sid/prompt_async | `{parts:[{type:"text",text}]}`，目标execution | 严格204无body，仅实际有界入队后 | 未知404、shape400、unavailable/满503 |

后一个路由把请求交给 fsm-5 的实际接收器；fsm-5 未接线时返回503，不能用noop204。未知route404，unsupported method405；body限1MiB，流式计数超限413；无DELETE或隐式execution创建。URL segment用decodeURIComponent一次，拒绝空id/损坏编码；注册 SID 精确查询，不解释文件路径。每次请求带owner/epoch，关闭后不向新owner投递。

## 4. 执行消息字段投影

按原 branch 顺序遍历，先建立实际 assistant toolCallId 索引与 toolResult 索引，再构造 envelope；两个有限遍历，重复call ID、未知result、结果toolName不符、坏时间拒绝，不搜索相似文本猜关联。

| Pi事实 | OC字段/行为 |
|---|---|
| user entry | info.role="user"；id/sessionID按§2；time.created=归一化entry毫秒；文本/image逐项成为text/file part |
| assistant entry | info.role="assistant"；time.created=通过整数检查的message.timestamp；缺该字段才用归一化entry毫秒，非法值拒绝；text→text part；thinking→reasoning part；保留文本及签名在details，不泄漏运行凭据 |
| assistant toolCall | tool part：tool=实际published toolName、callID=实际toolCallId、state.input=实际arguments；结果回填同一part，不另造assistant |
| 成功toolResult | state.status="completed"、state.output=完整text/图片/structuredContent的可读投影；完整原结果在metadata.pi保留；state.time.end=归一化实际result entry毫秒 |
| isError toolResult | state.status="error"、state.error=真实非秘密失败诊断、原input、time.start/end；不变成completed |
| 尚无result的实际call | 若已捕获start则running，否则pending；不制造成功结果/终结time |
| 所有实际calls已有result且assistant已完整message_end | info.time.completed=max(归一化assistant entry与关联result entry毫秒)；不能在仍在执行时补completed |
| assistant stopReason length/aborted/error | §7错误优先；保留原轨迹，不因局部capture抹除 |
| custom_message / message.role="custom" | 按实际content生成user envelope，metadata.pi.customType/details保留；Stop/Watcher文本因此可被证据取得 |
| bashExecution | 生成有标识的assistant envelope与bash tool part，实际command/output/exitCode/aborted；这是Pi用户shell执行史，不伪装模型call |
| compaction/branch_summary/context_edit/state-only custom | 不覆写既有原始message；metadata事件另保存在record；不把内部binding秘密送模型 |
| system entry/message | 保留实际system贡献为标明来源的user evidence envelope，metadata.pi.role="system"；不混成assistant verdict |

image part 使用file结构：mime=实际mimeType、url=`data:<mime>;base64,<data>`，来源完整保留；不虚构远端URL。tool part time.start 优先真实execution_start事件，恢复无该事件时用其实际owning assistant entry的归一化毫秒作为可明确辨识的观察下界（metadata.pi.startIsObservation=true），不用推测工具耗时。无结果时不写end。

nested executeTool不会有独立transcript call/result：Pi已把bounded nestedCalls留在parent ToolResult；在父tool part metadata.pi.nestedCalls逐项保留实际ID/input/result/error，不能伪造顶层assistant或丢掉路径/效果。具体nested字段用实际Pi ToolResultMessage声明/运行fixture承接。

store发布完整branch及terminal投影后，才能发布对应idle。starting/running/settling→busy，retrying→retry，实际settled的idle/failed/aborted→idle且错误消息保留；unavailable使读取503。parent从binding，不从header.parentSession（它是fork file关系）或SA runId推断。GET roster是BFS可达执行树＋独立judge roots；重复/跨root/环失败，不能省掉坏节点继续假完整。

## 5. Judge请求、闭集工具与参数

请求严格解析：system:string、tools:布尔map、format:{type:"json_schema",schema:object}、parts:非空text数组；按顺序join text，禁止从message body选择model/provider/extension/credentials。未知授权字段拒绝。schema使用真实Ajv编译，支持当前FSM已去root $schema的wire schema；坏schema在模型前失败。repair schema/system/tools来自每次原driver请求，不能偷偷沿用上一turn配置。

tools必须有 `"*":false`，仅允许下列7个业务名、StructuredOutput、external_directory，以及已知明确deny aliases。任何未知true拒绝；未知false无启用效果。StructuredOutput必须true。已知deny：write、apply_patch、list_mcp_resources、list_mcp_resource_templates、read_mcp_resource；无论Edit开启与否都不能通过别名暴露。

| OC名 | 参数 | 实际实现/映射 |
|---|---|---|
| read | filePath:string，offset/limit非负整数optional；offset1-indexed，0与missing按OC归1 | SDK read `{path:filePath,offset:offset||1,limit}`处理文件；目录走下述受控listing分支，不用无offset的SDK ls分页；图片保留 |
| grep | pattern:string、path/include:string optional | SDK grep `{pattern,path,glob:include,limit:100}`；默认cwd；不把regex改成literal |
| glob | pattern:string、path:string optional | SDK find `{pattern,path,limit:100}`；返回真实文件，保留glob含义 |
| bash | command:string、timeout:正整数毫秒optional、workdir:string optional | SDK createBashTool(workdir??judge.cwd)，timeout转换毫秒→秒；outer deadline/signal始终约束，不能忽略workdir |
| edit | filePath/oldString/newString:string、replaceAll:boolean optional | oldString非空且replaceAll=false：SDK edit原生`{path,edits:[{oldText:oldString,newText:newString}]}`；空oldString/replaceAll按下述独立分支，同样file mutation queue与路径权限；不依赖legacy prepareArguments，不额外开放write名称 |
| webfetch | url、format:text/markdown/html optional、timeout秒optional | 复用已读my-plugins/web-fetch的实际factory，注册名web_fetch→webfetch；wrapper传真实ctx/signal，outer deadline覆盖包括body读取；参数不丢 |
| websearch | query、numResults、livecrawl:fallback/preferred、type:auto/fast/deep、contextMaxCharacters | 复用已读my-plugins/web-search.ts实际factory，web_search→websearch；现有Exa MCP路径完整支持这些参数，不改查询语义；outer deadline/signal覆盖body |

目录Read分支：完成既有路径准入→stat确认directory→fs.readdir(path,{withFileTypes:true})获取实际完整项→directory加`/`，symlink用目标stat判断是否directory（坏链按实际名字保留）→按OC的a.localeCompare(b)排序→offset=输入offset||1、limit=输入limit??2000、start=offset-1→items.slice(start,start+limit)；limit=0合法返回空窗口，超出末尾为空。output使用实际路径、type=directory、entries窗口及实际总项数/后续提示；details保存offset/entries/totalEntries/truncated，preview为窗口前20项。有限目录项循环，不先在SDK ls已截断文本上分页；offset=2/limit=1必须取得第二项。结果最终显示若有host字节截断，details仍保留真实窗口且明确truncated，不能据截断数据重新计算总项数。

Edit分支：所有值先校验，oldString===newString零效果失败。oldString非空/replaceAll=false直接调用SDK原生edits数组（SDK执行自身withFileMutationQueue，不外层再取得同一queue造成死锁）。replaceAll=true在同一SDK公开withFileMutationQueue(path,fn)内读取原文件、明确所有非重叠匹配、零匹配失败、一次写回所有替换，保留原BOM与换行格式；取消检查在进入queue及每次await后，不提前释放正在写入的queue。oldString为空时，无论replaceAll值，在该queue内检查目标：目标已存在（含目录/已有symlink）拒绝，未存在才mkdir父目录递归并writeFile(...,{flag:"wx"})原newString（含其BOM）；`wx`在检查后遭其它写者创建时仍拒绝，不覆盖新出现的文件。父目录的创建是此Edit分支的明确副作用，创建失败可能留下已创建目录，必须报告失败、不假称回滚或成功；文件创建成功后的取消不得包装为未发送。沿既有cwd/realpath父链范围准入，包括未存在父目录的最近现存祖先；不新增write/apply_patch别名。计划测试普通原生参数、replaceAll/零匹配、空old创建嵌套父目录、已存在拒绝和取消。

web factories由安装manifest的顶层静态import提供给SDK隔离inline factory；只按固定原name重命名，不加载它们所在目录的其它扩展。没有这些实际factory/依赖时，明确503/not-ready，不伪装搜索支持。无需改外部插件。Judge registry只注册上述named wrappers及StructuredOutput；builtin `read/bash/edit/write`等不能额外启用，nested工具可达集合也须相同。每个wrapper在执行前按本turn实际allowed集合检查，不能只在模型可见列表隐藏。

external_directory是允许在judge cwd之外使用已准入调查工具的permission开关，不是可调用工具。不允许时对规范化路径/workdir做cwd范围检查；相对路径从judge.cwd解析；允许时保留绝对路径，不把add_dirs不存在的wire字段凭空造出来。禁止用string startsWith判断兄弟目录；realpath父/文件用于消解symlink。该开关不增加工具名。

Read/Grep/Glob为FSM基础调查能力；Review请求extra工具才启用Bash/Edit/WebFetch/WebSearch。它们不是P11 optional一般执行工具或AskUserQuestion。没有请求的工具不执行，不对真实provider/web调用自动做烟测。

## 6. SDK会话与单turn状态机

createJudgeSession(owner,title)：验证owner/容量/明确模型配置→插件归属agentDir/sessionDir→显式DefaultResourceLoader(noExtensions/noSkills/noPromptTemplates/noThemes/noContextFiles=true，只有judge inline factory)→reload并拒绝任何load errors→createAgentSession，tools初始只开StructuredOutput，customTools为§5闭集→bindExtensions→保存实际SID/file/header。失败回收本次session/loader，返回503而非假id；不同judge不共享capture状态。

SDK类型依据：当前1.0.3公开CreateAgentSessionOptions接收modelRuntime、model、tools:string[]、customTools、resourceLoader、sessionManager；setActiveToolsByName为每turn启用入口。不要用旧SDK的AgentTool[] tools签名。DefaultResourceLoader.noExtensions排除发现路径，extensionFactories仍实际加载（resource-loader.js:403、511、870）；只注入本judge factory。

模型取明确安装配置/根当前选择的physical默认模型，不接受HTTP选择。模型/auth承接使用公共ModelRuntime.create、InMemoryCredentialStore及根ModelRegistry公开的认证/streamSimple能力；不访问ModelRegistry.private runtime、不给新global auth store。每turn从根公开getApiKeyAndHeaders取得实际认证（不记录头/值），内存只属本owner；SDK streamFn委托原根registry.streamSimple以保留实际request-time认证/原provider。SDK自身模型/认证检查也要有真实配置，不能塞dummy key越过guard。虚拟/自定义provider须在安装时把其实际公开provider配置接到SDK，无法接线则明确not-ready而不暗换模型；具体账户/真实调用预算另行授权。

runJudgeMessage：取得该judge单flight→parse请求/schema/工具→建全新turn（清空旧capture/provenance）→设置本turn active工具→inline before_agent_start返回本turnsystemPrompt（不赋值只读agent.state.systemPrompt）→prompt(text,{expandPromptTemplates:false})，不会把HTTP文字当slash command→await完整prompt→从真实branch形成envelope→先发布完整record再idle→释放singleflight。请求失败/关闭/截止abort实际会话并等idle，无法确认给503；已经应用但HTTP丢失不自动再prompt。

systemPrompt来自inline handler返回的公开BeforeAgentStartEventResult；SDK保留正常prompt持久化，不操作私有_runAgentPrompt。会话关闭有界dispose；HTTP abort真等待session.abort与agent.waitForIdle，返回true后仍保留记录/可继续同sid。

## 7. StructuredOutput与终结 envelope

capture工具参数是当前schema；execute再次调用同一个Ajv validator，合法才记录真实toolCallId/value/time并返回真实工具result。无效输入返回工具错误，state.status=error，input与起止时间保留；不污染capture。相同完成对象可重复，不同完成对象保留两个实际captures，由原driver归conflict，不选择后者覆盖。

finishTurn wrapper先await原finishTurn；error/aborted/length优先，未完整tool batch不end；正常完整批次且至少一条合法capture则返回{action:"end"}，冲突也结束以返回真实conflict材料；无capture保留原decision。不能从tool_result hook返回不存在的terminate字段；abort不代替正常end。

| 必填终结字段 | 来源 |
|---|---|
| info.role | 固定assistant，因为来源为本次真实assistant |
| info.id/sessionID | 本次assistant真实entry与SDK实际SID |
| info.time.created/completed | 归一化实际assistant/结果持久化毫秒，completed非负安全整数；正常响应在SDKprompt结束后产生 |
| info.finish | stopReason length→length；error→error（同时error对象）；toolUse→tool-calls；其余正常→stop；不是完成事实生产者 |
| 每个StructuredOutput part | id/sessionID/messageID/tool="StructuredOutput"/callID取本次真实call；不是仅仅返回捕获的object |
| 成功capture.state | status="completed"、input=实际已校验object、output真实工具result、time.start/end实际值 |
| 失败capture.state | status="error"、input=实际object、error:string（非秘密校验诊断）、time.start/end非负整数 |

错误对象 `{name,data:{...}}` 必须真实；不可用message string推isRetryable。aborted→MessageAbortedError，length→MessageOutputLengthError，明确typed content filter→ContentFilterError，明确typed auth→ProviderAuthError，明确typed context limit→ContextOverflowError。APIError仅当实际provider provenance有合法status和明确retryability来源，data.isRetryable:boolean必填，statusCode只在100..599真实整数时提供。没有typed provenance的SDKerror使用UnknownProviderError/data:{}，原consumer明确按unknown进行自己的有界重试；不虚构APIError(false/true)或把capture盖掉error。after_provider_response只取status、不保留headers；provider_stream_event只有为实际配置API实现并测试的typed解析器可产生上述分类，其它事件unknown。

没有合法capture的正常终结返回真实completed envelope但无成功StructuredOutput，原driver进入missing-capture repair；length/error/abort仍优先，原driver不是桥拥有的循环。失败capture后同turn成功允许；两个不同成功capture为conflict；所有part先验证形状，不因早期成功跳过后面坏材料。

## 8. 函数推导与退出

- publishRecord：检查owner/actualSID/binding→复制真实branch/lifecycle→计算实际metadata→一次替换private snapshot；坏身份/时间拒绝，不能部分覆写；先terminal再idle保证Evidence不见假完成。
- projectMessages：有限两遍branch建立call/result对应→逐entry分支投影→校验所有part身份/时间→返回oldest顺序；未知result/重复call退出protocol-invalid，无IO；正在进行的call保持pending/running而非造end。真实索引保证result只回填owningcall。
- projectRoster/status：检查root/父树→有限BFS/seen→按lifecycle产生metadata与type；坏树或unavailable拒绝，不用空集合；这是组合原consumer的None live-work结论所需的全事实责任。
- parseJudgeInput：边界shape→schema编译→工具deny/allow→返回不可变turn请求；任一步失败零prompt；有限键/parts，不能借参数扩大tool registry。
- create/run/finish/abort：各前置/步骤/分支按§6/7；singleflight排除同sid交错，原SDKprompt+batch结束给终结事实，失败先回收自己资源；不消除既有session。
- handleRequest：auth→固定路由/shape→当前owner目标lookup→唯一callee→JSON/204；body有界、每个错误有确定状态码；不生成伪execution或秘密诊断。

所有数组/树有限；服务由root close取消，请求singleflight/容量有界；模型调用总截止和清理预算沿原caller约定。只做本单元一次原标准设计确认及实施后的原合同对照，不新增审查目标。

## 9. 实施与直接测试

计划files：records/session-record.ts、record-store.ts、oc-messages.ts、oc-tool-parts.ts、oc-roster.ts；protocol/oc-route.ts、oc-server.ts；judge/judge-input.ts、judge-tool-policy.ts、judge-file-tools.ts、judge-extra-tools.ts、capture-turn.ts、finish-turn.ts、judge-session.ts、judge-error.ts、judge-envelope.ts。按具体责任拆分，源码≤200LOC。

测试：真实SessionManager.inMemory append user/assistant/result/compaction/fork，当前原branch与compressed view分别断言；toolResult/orphan/duplicate、image、nestedCalls、坏时间、terminal-before-idle；请求wildcard/aliases/unknown allow、基础参数及目录、offset0/1、bash毫秒与workdir、edit replaceAll；real factory rename仅在隔离judge执行；faux provider完整batch+capture、无capture、先失败后成功、conflict、length/error/abort优先、同sid repair、unknown provider typed envelope；HTTP Basic/404/400/409/503/strict204/容量/关闭/abort确认。禁止真实key/provider网络测试，web以fake fetch/工具fixture替代。

退出：B5按既定workflow六项标准READY后编码；本单元实际测试/类型检查及一次原contract对照通过；rootready仍须child/gates/Watcher真实接线，所有成果不冒充整系统安装或OC-level完成。
