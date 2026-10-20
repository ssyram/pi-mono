# Contract Expectations — fsm-2-runtime-broker

事前合同：architecture P1/P2/P9/I2，detailed-design §5.2及subplans/fsm-2-runtime-broker.md。目的仍是完整FSM兼容与真实mandatory加载，不以表面ready或exit0替代事实。本表在本单元实现前产出，未从实现倒填实施位置。当前通道直接测试依据在../../test-reports/fsm-2-runtime-broker.md，最终本单元contract结算未完成。

## 1. 契约源

- 用户Q及首单元固定准入/不可缩减mandatory。
- 原设计审查B3：根加载/启动结果；B4：具体跨根独占机制。
- FSM process.rs：Linux boot ticks、macOS timeval微秒；identity-acquire实际await写槽后返回ok。
- SA runtime-agent-events.ts：独立extension注册通过实际SA owner listener。

## 2. 字段/Schema

HostIdentity：pid为正实际进程ID、startId为正64位十进制字符串。RootHealthLease：actual session/owner、manifest id/path、初始化与startup token结果、resource prepare、closed；不包含秘密。

identity wire：session_id、agent_id、tool_name、agent_cli=opencode、opencode_server_url；source register由现有route真实字段承接；其成功body为JSON null（仅尝试完成）。随后GET session/source?session读回session_id/agent_pid/kind/cwd/opencode_server_url/transcript_path，匹配当前真实owner才确认source。MCP保留jsonrpc/id/result/error与完整CallToolResult content/structuredContent/isError。

不得发明daemon可写pid或invocation identity字段；body/requestId/响应shape不合法明确失败。

## 3. 枚举/常量

health：初始化成功/失败、startup待完成/成功/失败、resources未准备/准备、closed；ready由条件计算，不是模型字段。

runtime errors沿父合同：not-ready、deadline-exceeded、transport-failed、protocol-invalid、delivery-unknown、cancelled、queue-full。native helper只读身份，不具任意route执行权限。

## 4. 流程

P1 manifest匹配→实际初始化→actual startup tokens→资源prepare→ready commit；P2实际HostIdentity→共享scope/key→atomic mkdir/token；P3权威source/identity响应→MCP request/response→lease release；P4失败/取消/未知→close确认/保留锁→owner清理。

有执行步骤的source保留Step Pn注释，types/barrel不伪造步骤。

## 5. 行为

- 文件存在/SA child registration不证明root实际loaded；不访问Pi私有runner或杜撰getLoadedExtensions。
- root不在串行session_start里等待后面的handler；startup回执按actual SID，旧epoch不能给新root ready。
- token分未来active集合与epoch冻结snapshot；初始化前注销不等它；本轮注销不删除已进Pi事件快照义务；本轮新增只到下轮，不死等不存在的当前callback。代理注销函数调用真实off并幂等。
- native Mac微秒不以ps秒值/Date.now代替；helper直接父PID须等于Pi process.pid。
- atomic mkdir是唯一独占点，所有roots用共同scope和真实pid/start/tool key；不是每root独立mutex。
- 已有lock不按mtime抢占；仅自己的token能释放；MCP已发送unknown必须确认Client关闭后才放锁；控制POSTunknown没有实际HTTP确认时，Client死不能证明daemon迟到PUT终结，保留租约并拒绝broker复用；尚未发送已取消/过期则安全退出。
- source登记JSON null不证明source存在，必须读回真实owner字段，404/错pid/旧URL/错SID/超时拒绝；source-auth不能代替登记确认。
- identity接线读取实际HTTP响应，非exit0推断；不得重放mutation或new invocation来掩盖delivery unknown。
- 工具发现全分页、重名/无效schema拒绝；注册冲突显式not-ready，不自动删除用户nativeMCP。

## 6. 时序/状态

事件代理保留原handler返回/异常语义；初始化失败不被新的session_start重置为健康。资源prepare不等于完整应用ready，尚未存在的protocol/gate/child能力不能被noop标成功。

同canonical acquire→response串行，不同canonical可并行；Review/judge不申请该lease。模型任务不能由managed factory在ready之前触发，普通诊断不触发turn可保留。

close先撤准入，随后取消/结束自己的resources；root close不删除FSM栈、公共Evidence或其它会话。

## 7. 不变量/性质

fake factory/token顺序排列：缺一个startup、任一失败、重复/旧session token都不错误ready；全部成功只commit一次。加启动前注销、本轮注销仍执行、本轮新增下轮生效三个快照反例，防虚假等待或过早ready。

实际目录并发：两个root同host/tool run区间不重叠；不同tool可并行；取得失败不执行run；foreign token不能删锁。

取消/unknown故障点：stdin未发送/已发送、登记尝试null但读回404/字段错/超时、identity失败、response错id、timeout/childexit；mutation不重发，锁释放顺序晚于response或close确认。

HostIdentity重复探测稳定；新真实进程startId不同。mac helperbuild/执行测试只读系统identity，无provider。

## 8. 性能/界限

lock/pending queues有界；等待仅到caller deadline，timer unref并清理；hook保持原900s lifecycle最低，MCP不附加无限清理。没有新业务SLO，不额外发明延迟基准。

## 9. 安全/副作用

源码、helper构建和开发测试/文档仅my-plugins；正常运行时coordination是私有OS临时目录，不修改外部代码。测试scope显式设到本插件temp。无全局mutable extension registry，ledger按本root/session归属。

Secrets仅受控env/凭据，helper每请求读新token；stdout/log/health/binding无secret。child/header可写字段不能替代真实peer身份或leased资源。

cc是明确helper构建步骤，不npm lifecycle；不改Pi/FSM/SA源码。全仓write check仍禁越界，缺根Biome依赖真实披露。

## 10. 对照与退出

实施前按原workflow§4.4确认B3/B4具体机制与剩余函数可编码性；实施后按本表和明确diff独立对照一次，差异限定处置，不无限重新审查。fake协议/进程 tests证明代码行为，不称完整Review/Stop/Watcher已经运行。

本单元退出不关闭协议/judge/child/gates/Watcher/安装/实际运行或mandatory命令翻译责任。
