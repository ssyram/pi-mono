# Loop 外层异常与资源修正（workflow §7.1）

## 1. 现象与复现

核证清单见 audit/cca-findings.md。实际命令 add once 2501999792h 可因加法越界reject；missing-id register和真实锁/EFBIG等失败从外层上传；工具add保存超Date once后list抛；shutdown清理后仍reject；真实补全委托ENOENT reject；失效ctx timer在catch外重排再抛。write/rename失败留下自有tmp。复现均在原run audit-tools/post-cca，未运行生产任务。

## 2. 根因

内部可失败操作没有在真实Pi外层完整承接；结果采集/通知/重排被误当作主动作的一部分，失败被误报为回滚或投递失败。safe integer时间域大于Date格式化域。temporary缺失败收尾。

## 3. 参考对照

非算法修复。现有executors将投递异常转failed，shutdown finally仅承担清理；沿用内部throw和busy结果，新增责任仅在边界。实际SessionManager先变内存再_persist；不强化为追加异常零痕迹。Node Date最大正毫秒8640000000000000；输入/消费统一此域而不是依赖RangeError。

## 4. 修复与分配合同（D）

- `notifyLoop(ctx,message,type):void`：pre合法或已失效的SDKctx；post尝试可用UI通知且不throw；不能成功通知不改变动作成功定义。通知是best-effort，不引入fallback模型消息。
- 扩展factory/command/session_start/session_shutdown：整个外层承接普通异常；错误反馈也不throw；shutdown仍保证dispose；失活工具不得重新创建runtime。启动失败不作已加载承诺，stderr只作best-effort加载诊断。
- `handleLoopCommand`：内部callee可按原合同throw，实际注册handler捕获；手动投递的try只包含投递，通知不得改写为投递失败。重排异常与动作阶段分开，明确动作可能已生效。
- `AiSessionActionResult.active`：可读为数组，不可读为null（unknown，不是空集）；结果构造捕获查询失败，不再次依赖失败查询。execute捕获普通创建/删除/取消失败，错误文案不声称回滚。
- tool execute：getActions/转换/动作普通异常转结构化失败；active unavailable=null。onMutation独立承接，保留已经取得的动作结果，加重排失败提示，不伪称动作回滚。
- completion三个方法：getSuggestions在try内await委托，失败null；apply失败返回原lines/cursor；trigger失败false。有限候选遍历与原排序不变。无新补全规则。
- poller：timer fire全过程不throw，包括armNext；重排失败则停止当前poller，不能保留running=true/无timer假运行。不新增恢复重试。start/reschedule调用失败亦停止并让现有外层承接。timer资源交回stop/dispose。
- once创建：正safe integer且≤Date最大值；模型/AI输入边界共用一个pure predicate。已有持久态仍可读取；describeSchedule/defer展示超域时直接显示epoch-ms，不对损坏/旧数据做隐式迁移或整目录抛出。
- catalog save：临时文件属本次写调用；失败write/rename时尝试删除自有temporary，原始异常保持。OS同时拒绝cleanup时保留诊断/残余，不宣称绝对无残留。
- catalog读取唯一性：pair(sessionId,registrationId)唯一；授权isIndexed/remove仍以definitionId+pair匹配；生产合法UUID输入不新增重复字段检查。

## 5. pre → post / 不变量论证

边界在try内执行全部可失败callee，catch只构造无副作用的错误文本与安全通知，所以普通错误不能上传；await位于补全try内，异步拒绝也进入同一出口。动作结果与重排/通知分离，因此后者失败不能改变已完成动作的返回事实。active查询失败仅得null，不推出无任务。timer arm失败停止，不再有假运行；原runDue结果backoff语义保留。Date predicate建立新once的toISOString前提，范围外读取仅数字格式，不抛RangeError。tmp catch只回收本次生成路径，不删除他人文件；原错误在二次失败后仍报告。

内部pre不重复验证；没有增加全域no-failure/SDK不会抛的假设。partial append、custom-only持久化、多owner缓存、stale lease保证仍待原清单裁决，不被本修复冒充已解决。

## 6. 回归与新增测试计划

基本：现有全部Loop测试与36项script基础设施测试。
回归：合法大delay错误不reject、Date域新once拒绝及旧状态展示、missing register/真实busy外层承接、startup/shutdown失败不reject且dispose、工具catch内失败不再次throw、after-mutation重排失败保留结果、真实异步补全委托失败后下一次可运行、timer重排失败停止、自有tmp写/rename失败收尾、pair重复读取拒绝但精确删除不误删其它定义。
边界：getter/UI通知失败不逃逸、正常投递后通知失败不变投递计数；NoWake脚本依旧未接线。
测试输入尊重原pre，不以恶意getter/OOM/同步timer伪造生产Bug；getter/notification测试仅约束已授权外层接收真实SDK失效形态的接口保证。

## 7. 代码清单

新领域模块：loop-notification.ts、loop-error-message.ts、v2/valid-once-time.ts、format-timestamp.ts、shared-catalog-codec.ts、atomic-catalog-write.ts。为保持200 LOC限制，原职责拆为create-loop-core.ts、runner-mode.ts、run-prompt-now.ts、loop-completion-candidates.ts，未新增业务能力。
改动：extension.ts、loop-command-handler.ts、v2/ai-session-actions.ts、register-v2-tool.ts、due-poller.ts、loop-command-autocomplete.ts、definition-store.ts、format-list.ts、model.ts。
新增回归测试在test/，不是audit-tools；临时审计脚本仍只在run目录。不得修改packages官方源码、source loader/sessionmanager、脚本功能入口或save-msg接线。

## 8. 文档清单与未完边界

本方案、audit/cca-findings.md、现有ver-2.0架构/细化中外层错误/时间/清理保证同步；测试依据回填test-report。I1/P1/P2/L1和交付ack语义不随此补丁被标修复，不通过默改pre降低用户要求。不提交，不追加审查轮次；函数直接测试与类型/lint属于实施义务。

实施状态：上述直接项已实现，outer-*新增15项回归已通过；全插件阶段回归122/122通过，root npm run check通过。插件strict tsc因并行新增Boulder接线的类型/配置错误暂未通过，不能称整个插件类型无误；本批错误另行修正并重跑。既有脚本基础设施仍未接线，待决保证不随测试数被消除。
