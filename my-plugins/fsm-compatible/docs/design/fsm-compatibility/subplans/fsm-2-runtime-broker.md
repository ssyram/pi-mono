# fsm-2-runtime-broker：根健康、身份协调与原通道

状态：B3/B4与D2-1/D2-2已按原workflow标准确认READY；通道组件已有37项runtime、22项旧单元回归、真实FSM0.11.0/wire2隔离通道1项及插件tsc通过。完整根入口/SA/protocol/child/gates/Watcher接线及最终实施contract结算仍待完成；不是更换架构。父合同：architecture §4.1/4.3、P1/P2/P9/I2。首单元的policy/binding直接复用。

## 1. 本单元P

R1 根ready必须建立在实际self/mandatory factory初始化及本session所有必需startup callback成功上；路径存在、SA子扩展注册不等于根已加载。
R2 所有根/子FSM调用由根进程直接spawn的helper/Client通道执行；canonical身份登记实际确认后才发MCP。
R3 同实际宿主进程身份/canonical工具的acquire→response区间互斥；不是per-root独立mutex，迟到/未知响应不能与新调用交错。
R4 startup/shutdown/失败按本owner获取资源逆序回收；未就绪不开始受控任务，不隐式启动daemon，不修改官方/第三方源码。

## 2. B3具体机制：自有固定bootstrap，不访问私有runner

### 2.1 ManagedBootstrapManifest

固定manifest含self入口和配置规定的companion `{id,canonicalPath,factory}`。factory由安装阶段生成的**顶层静态import**绑定到相同canonicalPath，正文保存非秘密id/path；不动态import，不用模型传来的函数/loaded标记。当前配置与manifest的id/path必须一致，否则not-ready并要求重新生成入口。

入口仍是官方Pi的ExtensionFactory。它在原Pi进程中组合这些factory，不创建另一个模型宿主或另一个虚拟root SessionManager。所有原API方法继续转发到真实Pi；SourceInfo在Pi中归组合入口不等于GUI展示所有独立插件，本阶段不承诺改变Pi插件展示。

实际factory导入/初始化失败不给ready；self正常加载后，任何companion初始化/startup失败由健康记录保留并维持not-ready。入口自身无法加载属于安装/启动失败，不能声称FSM运行域已建立；安装单元必须显式检测该失败，不把正常无插件Pi运行冒充兼容成功。

### 2.2 installManagedFactories(pi, manifest, coreFactory): Promise<void>

pre：manifest来自实际静态imports，id/path匹配canonical policy；coreFactory接收本root的HealthLease接口，注册input/tool等not-ready guard。callee：真实factory、原pi.on。

步骤：先注册bootstrap自己的session_start begin处理器→为每个factory建立API Proxy→执行初始化→记录初始化成功或失败。Proxy拦截on注册及ready前会触发回合的sendUserMessage/sendMessage；其余工具/命令/flags/providers等仍调用真实Pi API。session_start handler注册时给它唯一token并加入该factory的活跃注册集合；返回的包装注销函数同步删除未来注册token并调用真实Pi注销，重复注销幂等。bootstrap begin处理器在所有managed startup callback之前注册；每个epoch begin从活跃集合冻结本轮expected快照，对齐Pi事件开始时复制的handler列表。包裹handler仍返回原结果、await原promise；完成时记录actual ctx.sessionManager.getSessionId与token，throw时先记录失败再让Pi按原规则报告。

初始化结束前注销的token不进入本轮snapshot。当前startup中注销只影响未来活跃集合，不抹去已进入当前Pi事件快照的义务；当前startup中新注册的token只参与下一轮snapshot，不使本轮等待实际不会执行的callback。wrapper仍可在Pi已复制的当前列表中执行，所以本轮结果按冻结snapshot判断。测试分别覆盖启动前注销、本轮注销仍执行、本轮新增留到下轮。

禁止在core的session_start内等待其它必需handler完成，这会和Pi串行await死锁。core先准备资源但不提交ready，完整运行依赖的protocol/gate/child尚不存在时不能用noop表示prepared；每个wrapper完成时调用maybeReady，只有所有初始化及该session的全部必需token都成功，且core资源已准备，才提交ready。没有startup handler的factory在初始化成功后满足其startup部分。

跨new/resume/reload用实际session_start重新建立session-owned ledger；旧session回执不影响新lease。初始化失败不因新session清空为成功。ready callback只调用一次，任何失败维持not-ready。关闭ledger和本owner资源，不用globalThis插件状态。

### 2.3 RootHealthLease

字段：actualSessionId、ownerEpoch、activeRegistrations（未来handler集合）、expectedSnapshot `{id,path,startupTokens}`（本epoch冻结集合）、initializationOutcome、startupOutcome、resourcesPrepared、closed。闭包私有可变状态；公开snapshot只提供不可变非秘密状态。

`beginRootHealth`从actual ctx取ID；`observeStartup`必须匹配session和owner，重复token不重复提交；`commitRootReady`检查所有条件，failure不发生受控任务副作用。

not-ready input返回handled并给具体初始化诊断；受控tool_call返回block；bridge请求503。managed factory若在ready前调用会触发模型回合的sendUserMessage/sendMessage(triggerTurn)，由API代理明确拒绝，不偷偷在初始化期间启动任务。普通诊断custom entry/message不触发turn可保留。

这证明的是本组合实际加载/启动过程，不要求任意外部插件自述健康，也不要求修改companion代码。其它入口的raw SA派发仍受首单元及后续child启动准入约束。

### 2.4 SA注册所有者

runtime agent注册使用已查明的 `registerAgentViaEvents` / `pi-subagents:runtime-agent-register:v1` 合同，实际安装的SA listener替调用者注册到**其自身ExtensionAPI所有者**；不将fsm-compatible自己的pi直接塞给SA WeakMap而假设两者相同。无兼容listener/错误结果not-ready。来源：SA docs/extension-api.md §Runtime agent registration、src/agents/runtime-agent-events.ts。

mandatory child registration仍用公开required-child-extensions按真实sessionId注册，requireForAllRunners=true；root实际健康与child未来加载是两个独立事实。

## 3. B4具体机制：实际进程身份＋原子目录独占

### 3.1 readHostIdentity(owner): Promise<HostIdentity>

Linux：读取`/proc/<process.pid>/stat`，按第一个左括号/最后一个右括号分comm，后续字段19为start ticks；PID与当前process.pid一致。

macOS：插件的小型C helper通过getppid取得直接启动它的Pi进程PID，使用系统`proc_pidinfo(PROC_PIDTBSDINFO)`读取pbi_start_tvsec/usec；返回PID和微秒startId十进制字符串。根验证PID=process.pid、startId正且64位范围。与原FSM process.rs一致，不用Date.now、uptime、ps秒级lstart替代。

helper源/构建输出都在插件目录；已有本机`/usr/bin/cc`与系统SDK可构建。构建是明确的插件开发/安装步骤，不运行npm lifecycle脚本。无第三方native npm依赖；分发可带对应平台helper，缺失/不支持平台明确not-ready，不伪造PID或精度。

源码依据：FSM crates/server/src/process.rs的Linux字段解析和macOS timeval微秒合成；已读系统libproc.h/proc_info.h的真实声明。此helper只读身份，不连接daemon、不运行模型。

### 3.2 CoordinationScope

共同运行时目录为`os.tmpdir()/pi-fsm-compatible-<uid>/coord`，所有本机包副本按相同规则计算；这是运行时协调资源，不是修改外部代码。开发测试显式将scope定向到插件test临时目录，所有开发源码、测试、文档与构建产物仍限my-plugins。

key为真实HostIdentity `(pid,startId)`＋canonical工具名SHA256。目录0700；拒绝符号链接或其它UID的基础目录。不同root不能自选不同scope造成假互斥；同宿主同工具始终相同lock path。工具名来源Client catalog，不来源任意模型路径。

### 3.3 acquireCanonicalLease(scope, host, tool, deadline, signal): Promise<Lease>

pre：已验证实际host identity、固定scope、catalog工具。callee：Node mkdir/writeFile/lstat与有界等待timer。

步骤：mkdir lock目录为原子独占点→成功写owner metadata（随机leaseToken、实际pid/startId、rootSessionId）→返回私有lease；已有目录等待，取消/截止立即退出，未取得不执行run。写metadata失败仅回收本次刚取得目录，不删除其它持有者。

释放只由同lease的finally执行：核实owner token→在MCP已完成或已确认本Client关闭后删除owner文件/目录。未知MCP结果先关闭并等本Client终结，不能先放锁；无法确认关闭则保留锁，错误显式传播，不假装可复用transport。控制POST已经开始但helper没有取得实际HTTP确认时，Client终结不能证明daemon迟到PUT已结束：保留本租约并关闭/禁止复用broker，不把控制写入unknown套用MCP关闭释放条件；尚未发送时已取消/过期则不写入并安全释放。

不按mtime自动抢锁，不在其它调用中删除疑似stale目录。实际宿主死亡后的新进程有不同精确startId，使用不同key，旧目录不造成新代误配；可留给受控清理，当前不新增GC。原同进程正常错误/取消均经过finally；旧runtime未完成的请求不由新runtime强行解除。

循环只等独占资源且受deadline/signal；timer unref、结束清理。lease数据不暴露给模型。证明：mkdir保证同key唯一持有者；持有区间覆盖identity→响应/关闭确认；PID复用由startId区分；token确保只释放本次资源。

## 4. 原daemon helper与MCP

### 4.1 daemonRequestViaHelper

根直接spawn `.mjs` helper，不经另一个Node sidecar或shellwrapper。request仅允许本broker使用的固定routes：capabilities/health、session/register、GET session/source?session=<rootSessionId>、identity/acquire、actor/acquire、evidence/source-auth；每次新短连接，读同一FSM_DATA_DIR下auth.token，header x-fsm-auth。

stdin输入与stdout response均有body上限、全deadline和schema；实际HTTP status及各route body合同经过校验，exit0不是确认。特别是POST /session/register的合法成功body为JSON null，只证明一次best-effort登记尝试返回，不证明source存在；不能要求它返回{ok:true}，也不能据null提交ready。未知响应/非JSON错误不反转成功。pid不由请求body传入，SO_PEERCRED严格父链仍是原authority。

session/register用真实rootSessionId/cwd/OC-compatible路由，随后必须GET /session/source?session=<rootSessionId>读回，核对body.session_id=本root、agent_pid=实际Pi宿主pid、kind=opencode、cwd与opencode_server_url均等于当前owner登记值、transcript_path=null。404/超时/非合法shape/任一不符都不能ready或发本次MCP。读回不修改FSM；source-auth仅认证更新，不能代替登记确认。该现有路由做存活/真实进程身份过滤，不新增可写PID协议。identity/acquire的字段精确为session_id、agent_id、tool_name、agent_cli=opencode及路由地址；canonicalTool是catalog发布名。读token每请求刷新，daemon重启旧token不缓存。

### 4.2 openMcpTransport / invokeFsm

Client由同一根Pi直接spawn，显式pipe并排空stdout/stderr。MCP JSON-RPC以newline framing处理initialize/initialized/tools/list/tools/call；只接受与requestId匹配的response，不猜stdout日志为JSON。

invokeFsm：验证principal/tool schema→有界排队（默认64，满时副作用前queue-full，owner关闭取消未开始等待）→取得CanonicalLease→完成source登记尝试并读回确认→确认identity acquire→MCP call→完整保留CallToolResult→释放lease。has structuredContent/isError/progress按原MCP合同保留，不只拼text；tools/list分页完整收集，catalog重复/shape错拒绝ready。

cancel前未发送无mutation；已发送未确认delivery-unknown且不重发，关闭本Client等终结后才放lease。重新连接重新capability/catalog，不自动重放工具。

不持identity lease等待child完成、Stop或Watcher；Review反向judge不申请该lease。检测既有nativeFSM MCP/工具命名冲突，明确not-ready，不自动删除用户已配置服务。

## 5. 资源与函数正确性

openOwnedRuntime分prepare/commit：prepare验证配置、实际root健康、能力、host identity，取得Client/helper/bridge/disposers但ready=false；commit由health maybeReady通知，所有条件成功才激活。失败逆序释放本次资源；不会把SA required注册当root加载证据。

closeOwnedRuntime先关闭准入，取消未发送项，结束本Client/helper/bridge/registry，再释放本lease；退出不删除FSM栈或公共Evidence。所有listeners/timers/stdio/servers只属本owner，unref＋shutdown双重处理；不能仅依赖session_shutdown保证崩溃持久性。

关键信息来源链：manifest静态import→实际factory初始化→actual session_start tokens→core resource prepare→ready；物理PID/内核startId→单一scope/key→atomic mkdir/token→source登记尝试/读回→identity实际响应→MCP实际响应→release。

每个中间事实都有产生者，错误出口不变成{ok:true}或ready。代码后的测试必须分别证实startup失败、跨root同工具序列、不同工具并行、cancel/unknown关闭顺序与释放、protocol错位/重复响应和shutdown无泄漏；不是要求设计阶段先调用真实provider。

## 6. 拟实施文件与验证

runtime/root-health.ts、managed-bootstrap.ts、host-identity.ts、host-identity-macos.c；coordination/canonical-lease.ts；process/owned-process.ts；broker/daemon-request.mjs、daemon-request.ts、mcp-transport.ts、fsm-broker.ts、fsm-tools.ts。必要拆分按具体概念，源码≤200LOC，barrel不写业务。

测试使用fake factory/ctx、实际临时目录和fake MCP/helper可执行fixture；macOS identity helper只查询真实测试父PID，可直接验证稳定和代际不同，无provider。真实FSM binary smoke在isolated FSM_DATA_DIR中另运行，不接现有daemon，不消耗token。

本单元只建立资源/协议通道；OC HTTP/judge完整服务由fsm-3提供，默认不能用假的服务端证明Review/Stop已可运行。未得到相应能力时仍明确报告not-ready/不可用。

## 7. 边界与退出

该机制补齐B3/B4原要求，没有新增OS sandbox或任意future provider保证。构建macOS身份helper的cc需求已明确；当前机器可用，完整安装阶段不能隐瞒该条件。

正式实现前依原workflow标准确认本单元具体机制，补本单元事前expectations；实现后直接测试及一次原合同对照。首单元PASS保留，不重复审查它。根只读检查缺Biome依赖的实际限制仍披露，禁止越界重装根依赖来抹掉问题。
