# fsm-3 实施对照处置

原报告：run487ceb60（tmp-Haokun/glm-5.3-flash，承接6e7c323b/171217c2两次基础设施中断后完成），audit-report-initial.md；结论BLOCK：P0-1+P1-2～P1-5，P2×5。任务完成≠接受，已逐项核实后全部接受。

- **P0-1 同意**。abort未保存运行中Agent/无取消等待，返回假true并假报idle。修复：JudgeEntry保存当前Agent；abort时agent.abort()→有界waitForIdle（超时not-ready/503）→确认后才idle/true；无Agent时本就idle。
- **P1-2 同意**。原consumer abort发空body；readBody对空body JSON.parse("")→400。修复：零长度body返回undefined，abort忽略body；需要body的路由自行校验。
- **P1-3 同意**。judge message shape错应400而非503（坏关联/坏时间的503不变）。修复在oc-handlers边界把parseJudgeInput的protocol-invalid转为OcHttpError(400)。
- **P1-4 同意**。webfetch/websearch被请求但静默缺席。修复：请求任一web工具而factory未接线时run抛not-ready(503)，安装单元接factory后替换；补测试。
- **P1-5 同意**。FailedCapture未存真实toolCallId，envelope捏造so_N。修复：失败记录真实toolCallId并使用；补断言。
- **P2-1 采纳删除**。wrapFinishTurn/classifyJudgeFailure为死代码（judge-session内联finishTurn承担实际收尾；unknown分类由oc-messages承担且consumer兼容）。删除两模块及其测试；typed provider分类（ProviderAuth/ContextOverflow/ContentFilter/APIError+isRetryable）在fsm-5/安装的真实provider事件接线时按合同落地，不由死代码冒充。
- **P2-2 同意**。JudgeSessions加maxJudges容量（默认64，create超限queue-full→503）；构造校验model/getApiKey/streamFn缺失即not-ready。
- **P2-3 接受并承接**。judge会话当前内存转写（randomUUID、sessionFile:null）；expectations未要求持久化，跨重启retained-judge续跑能力在fsm-5/安装单元显式承接或声明边界。
- **P2-4 同意**。children对judge返回[]；bashExecution改为真实bash tool part（callID=bash_+entry.id，state.input.command/output/exitCode/cancelled，exitCode非零或cancelled→error）；edit特殊分支每次await后复查signal。
- **P2-5 同意**。补用例：运行中abort真确认、空body abort、judge shape 400、失败capture真实callID、web请求503、create容量503。

修复后重跑 test:judge/test:protocol/全量+tsc，再生patch并请原审查者限定确认上述项；不重开已通过部分。

## 结算

限定确认run801121cd（原审查者）返回PASS：P0-1、P1-2～P1-5全部闭合，P2-1/2/4/5处置到位，P2-3承接在案；报告audit-report.md。两条记录级P2（r1 mkdir后signal缺口、r2 part id双计数重复）已即时修复：r1在mkdir与wx writeFile之间补signal复查；r2改用单一parts.length计数并新增part id唯一性断言；修复后全量judge16/protocol14/admission22/runtime37+tsc 0。**fsm-3-protocol-judge技术结算PASS**；不关闭根目标，fsm-4/fsm-5/安装/mandatory翻译责任继续。
