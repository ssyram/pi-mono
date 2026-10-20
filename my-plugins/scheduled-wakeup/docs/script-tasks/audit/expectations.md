# Expectations — loop-script-1-infrastructure

实施前从 overview / architecture / detailed-design 抽取；不以实现现状更改标准。

## 1. 契约源

overview Q1–Q9；architecture P1–P9与数据结构、外部合同；detailed-design所有函数/回调规范；save-msg-path-fix八部分。用户已授权全面Hoare和直接测试，独立reasoner只能按这些前提判断。

## 2. Schema 字段

输入wakeUp(kind,prompt,aggregation)、scripts(cwd,path,params,timeoutSeconds)；输出ScriptResult(script,status,exitCode,signal,stdout,stderr,error)及TaskRun(wakeUpId,results,successCount,shouldWake,content)。本阶段无持久化/跨进程JSON协议，JSON schema N/A：unknown边界由prepare运行时校验，类型与真实测试对照；不新增无消费者schema文件。

## 3. 枚举

wakeUp never/always/on-error；aggregation and/or默认or；status success/failed/timeout/start-failed。所有消费者import task-spec类型，不复制模型。默认timeout常量1800仅一处。

## 4. 流程

P1 prepare → P2 run每项 → P3聚合 → P4一次构造正文 → P5纯展示。execute-task接线注释对应P2/P3/P4；通过单一runner注入测试观察执行次数/顺序。不在现有extension/命令/poller导入。

## 5. 行为

任一失败默认唤醒；and只全失败；全部执行无fail-fast。never+[]与on-error+[]拒绝，always+[]合法。argv条目不shell拼接；params内$VAR/glob不展开。成功=code0正常退出，无timeout/error/signal。

## 6. 时序/状态

同批次顺序、每项独立timeout；finite的超时结果不被exit0覆盖；null不建timer。close/error只结算一次。状态归每次调用，不创建全局session缓存。正常结束/超时均释放拥有timer/pipes并清理所属进程组。None不终止导致批次不终止，不能被误称bug。

## 7. 不变量 / property testing

- 全部长度≤8的success/failure布尔排列：or等价存在failure，and等价全部failure（空=false），always/never固定。
- 数组逐项调用一次、失败不减少结果长度、结果顺序不变，计数等于成功项数。
- 不同输入数组/params准备后相互隔离；不修改原输入。
- 展开串尾部===run.content；正文块数=结果数，紧邻真实script开标签的FAILED标记数=失败数（不把输出中用户自带的文字当结构标记）。
- 路径~在resolve前展开，absolute与relative及~/额外斜杠遵循设计。

使用node:test的穷举性质测试，无新增property框架依赖；适用于有限布尔域且穷举比抽样强。结构字符串以固定种子生成额外字符组合。

## 8. 性能/截止

单项timeout真实测试使用短合法秒数和宽松墙钟上限以捕获永不终止，不声称实时保证；timer分片用mock timers覆盖>32bit毫秒，null无timer。无限任务真实短程序验证未错误使用默认timeout，长非终止不运行。输出完整保留，不另设限额。

## 9. 安全/副作用

真实shell/node测试临时cwd与文件、无provider/token。真实超时覆盖忽略SIGTERM及同组后代防止延迟写标记；异常/不存在文件/NUL/不可执行/cwd不存在等输出失败而非批次throw。动态分隔符转义。只新增未接入源码和测试；不改production模型、codec、命令、renderer注册或save-msg/output。

## 10. 跨实现一致性

只有一个实现，无跨语言消费者，N/A。模型上下文与用户展开共用content；API custom→user事实仅据宿主源码，不声称真正system role。路径模块为未来两消费者共享，不以未接线基础设施说生产Bug已修。

## 预定独立推理过程

一次fresh-context并行六角度：功能、异常、资源、跨边界、规格覆盖、输入边界。先从设计提取pre/post，再对每个分配函数/回调CFG写NSP；所有循环按k=3/归纳/variant；外部事实查一手源码/Node类型与真实本地测试。结论报告逐项合同与反例，不增加设计外的防御性要求。主协调者裁定finding、修复合同违例并跑回归；不会因审查者建议追加新审查轮次。

workflow契约对照另要求独立reasoner依据设计及本次新增文件patch抽取expectations，不以实现自述当证据。该视角同规格覆盖lane完成，不额外反复复审。

## 实施后依据

待填：测试命令/计数、类型与根检查、六角度输出指针、finding裁定、未接线文件边界及外部前提残余。
