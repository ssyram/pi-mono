# Contract Expectations — fsm-3-protocol-judge

事前源：architecture P5/P6/I5-I7；detailed-design §5.3/5.4；subplans/fsm-3-protocol-judge.md；原独立审查B5。尚未读取本单元实现（无对应生产代码），不倒填实施位置。

## 1. 契约源

原FSM evidence roster/live-work/raw-message及agent_cli strict completion consumer；当前haokun-code工具Parameters；官方Pi SessionManager原branch与当前1.0.3 SDK公开类型/生命周期。判断基线是用户完整FSM兼容，不能以实现材料反写目标。

## 2. 字段/schema

roster：id/parentID/title/time.created/updated来自实际SID/binding/header/event。messages：info.role/id/sessionID/time与parts；part.id/sessionID/messageID/tool/callID/state.input/status/output/error/time。judge终结完成字段必须实际整数；error.name/data为实际分类；APIError若生成须有来源明确的isRetryable。新turn capture清空，不沿用oldturn。header/entry的canonical ISO字符串先Date.parse与toISOString roundtrip并验证非负安全整数；message/event数值独立验证，非法不fallback。raw记录保留原字符串，wire时间/max全用归一化毫秒。

输入：system、tools boolean map、format(json_schema/schema)、text parts；HTTP不能选择model/root/provider/extension/auth。声明准入后不任意沿用未知字段。

## 3. 枚举

生命周期沿既有SessionRecord；OC status仅busy/retry/idle，unavailable不省略条目而503。judge tool闭集read/grep/glob/bash/edit/webfetch/websearch/StructuredOutput；external_directory是权限开关；write/apply_patch/MCP resource aliases始终deny，不是Edit alias放行。

错误沿原consumer：MessageAbortedError、MessageOutputLengthError、ContentFilterError、ProviderAuthError、ContextOverflowError、APIError、UnknownProviderError；未知不捏造retryability。记录真实来源，禁止substring猜秘密原error内容。

## 4. 流程

P1 actual binding/header/raw branch→call/result关联→完整terminal snapshot→idle。
P2 auth→固定route/shape/target→实际records/judge/delivery→明确HTTP响应。
P3 isolated loader/SDK实际创建→单flight请求解析/schema/allowlist→实际prompt/完整batch→原finishTurn后合法end→严格envelope。
P4 cancel/deadline/shutdown→等待实际abort/idle→保留session/日志；无法确认非true。

源码流程保留Step Pn注释，不在types/barrel制造步骤。

## 5. 行为

- 原branch取祖先链，不用压缩后的模型projection删除历史；不串其它branch。
- 每toolResult只关联实际call；未知、重复、toolName不符失败；中途真实call无result保留pending/running，不造completed。
- nestedCalls保留父tool metadata而非伪造transcript顶层call。
- 基础read/grep/glob实际可调查；目录使用真实readdir项、目录/symlink目录`/`、localeCompare排序、offset||1与limit??2000后slice，不能在已截断ls文本上分页；目录offset2/limit1、默认2000、limit0及末尾空窗均测试。regex/glob/默认cwd保持；bash毫秒→秒且workdir生效。edit普通分支传原生path+edits数组；空oldString且不存在在同queue内创建父目录/文件wx，存在则拒绝；replaceAll必须全部替换，零匹配失败，不额外启用write/apply_patch。
- 已请求且实际支持的Review extra完整接通；缺factory/依赖明确not-ready，不只在prompt写已支持。web factory只按固定name适配，outer deadline包含body读取。
- tools wildcard deny、closed registry、执行时allowlist三者均满足；不加载execution extensions/FSM/dispatch/Stop。
- StructuredOutput只校验成功后记录；失败尝试与重复/冲突保留真实parts，原driver决定repair/retry，不新增桥内循环。
- HTTP204只真实队列接收，未接fsm-5时503；abort JSONtrue须跟在实际停止之后。

## 6. 时序/状态

actualSID不是runId；header.parentSession不是execution parent；终结消息先于idle；旧owner不能给新owner提供ready/投递。独立judge不是execution孩子。单judge同sid POSTmessage singleflight，不把并发输入排成隐式多turn。

完整batch后原finishTurn先执行；length/error/abort优先于capture；至少一条有效capture的正常turn可end，conflict也作为真实材料返回。无capture保留正常SDK决策并返回实际终结envelope。

## 7. 不变量/性质

真实in-memory SessionManager：compaction前后原history一致，branch切换不串消息，call/result映射唯一；same message/part identity property遍历；坏关联不产生半snapshot。

任意工具allow子集不启用deny aliases/FSM/未准入工具；每turn capture独立；valid/invalid/duplicate/conflict及terminal优先级组合测试；faux provider完整多toolbatch正常结束，不用abort当end；repair在同actualSID。

unknown error没有虚假APIisRetryable；APIError必须有真实来源。真实事件time保持整数，没有historicalnow填补；合法ISOentry/header与对应整数产生相同wire毫秒，坏日期/坏数值失败。capture不同成功值保留列表，正常完整conflict批次也在原finishTurn后end，由driver判repair。

## 8. 资源/界限

body≤1MiB，session/request queues容量有界，deadline派生自真实caller，loader/SDK/HTTP/listeners只归本owner，关闭逆序回收；不新增性能SLO或真实provider测试门槛。

## 9. 安全/副作用

仅my-plugins源码/文档/开发测试；loopback Basic auth、秘密不在binding/rawHTTP诊断/模型参数。SDK模型/认证走公开API、内存owner，不访问private runtime/全局可变registry，不改根process.env/global配置。默认root模型不可用时不暗换模型；真实token/web调用需明确数据/预算授权。

结构化path范围由cwd/realpath决定；external_directory不增加工具或宣称OSsandbox。无judge execution actor/source登记，无原FSM公共Evidence文件写入。

## 10. 一致性/退出

静态设计先按原workflow六项标准限定闭合B5及直接同合同问题；实现按本表和明确diff独立对照一次，原firstunit/fsm2结论不重开。需实际直接测试/插件check；根writecheck边界仍保留。

本单元没有实现之前，不以expectations文档证明Review已运行；通过后仍不能关闭child/gates/Watcher/安装/完整运行/mandatory命令翻译的责任。
