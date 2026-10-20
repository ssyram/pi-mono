# fsm-2 设计审查处置

原报告：run2f9528ec-f71f-46d4-b783-a5f5f455be2f，design-review-initial.md，结论BLOCKED；未把任务完成当设计通过。

D2-1：同意。实际/session/register忽略best-effort结果并返回JSON null，不能单靠HTTP成功证明source存在。修订固定helper routes：POST登记尝试后GET /session/source?session读回，必须核root/pid/kind/cwd/URL及null transcript，失败不得ready或发MCP。source-auth不作为登记证明。没有改原FSM协议或自动重放未知mutation。

D2-2：同意。实际Pi on返回注销函数，事件开始复制handler列表；只维护“注册过的token”会死等不存在的callback或错误等待本轮新增handler。修订为未来active注册集合＋epoch冻结snapshot；包装off同步真实注销，启动前注销不进入snapshot，本轮off不抹去已经捕获义务，本轮新on只用于下次。旧SID/epoch、初始化失败和单次commit规则保留。

合同、detailed-design相应source确认段和事前expectations已同步。新增直接测试计划包含三种handler snapshot/注销场景，以及register null但读回404/字段错误/超时。

限定确认run1fe740c1-3167-4e2a-b74d-58a4dd4d6f04已返回D2-1/D2-2闭合、READY、critical/unresolved=0；报告保存在design-review.md。通道组件现已编码，runtime37/37、首单元回归22/22、插件tsc及实际FSM0.11.0隔离通道1/1通过，详见../../test-reports/fsm-2-runtime-broker.md。完整根入口/SA/child/protocol/gates尚未接齐，本单元最终实施contract对照未进行，不声称Root完整运行或单元PASS。

首单元PASS不重开；B5-B9仍为后续单元责任。修正确认不要求真实provider、额外OSsandbox、GUI或optionaltools。

## 最终实施对照结算

run0a4d3c9a（新context、授权reviewer、路径B）：**PASS（0 critical/0 unresolved）**，报告audit-report.md。三项记录级P2处置：P2-1补coord base目录lstat复查（同uid 0700，纵深防御）；P2-2保留（SIGKILL后实际不可达，错误保真度备注）；P2-3 allowlist扩容含/check-permission、/stop-check系fsm-4门禁真实调用方，固定白名单有据。边界观察（根入口暂无调用方）属fsm-5组装责任，与§10一致。**fsm-2-runtime-broker技术结算PASS**。
