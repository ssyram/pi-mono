# D.service — 当前同步 Result 服务合同

承接 D.root 的来源独立与公共运行边界不外抛。服务 adapter 已接到源码初始化入口，真实 Pi 加载/验收未知。运行接线及会话有效性见 [integration-contracts.md](integration-contracts.md)；本 frame 不靠Pi吞错证明成功。

## P / M / R

P：单provider、同步reply；只操作resolver确认的当前session；get只读，set复用内部writer；失败结果可见且不假回滚，reply/诊断失败不再抛。
M：bus频道→handler校验→handleRequest→read或write→一次reply→client的本调用容器→Result。无结果缓存或跨进程机制。
R：emit返回void且宿主捕获handler错误，不能用emit返回/无报错判成功；显式同步reply与三态分支建立success/unavailable/failure。内部分支异常由本frame的catch承接，cause作为值保留。

前提：正常资源、有效SDK bus、一个provider；语义结果的signal/snapshot须满足既有类型不变量。运行错误即使是非Error或描述失败也不可漏出。上下文过期后调用者必须重新创建client；对象身份不是跨进程/永久session句柄。

## 1. 公共数据

`BOULDER_INHIBITION_SERVICE_CHANNEL="omp:boulder:inhibition:v1"`。request=`{session:object,op:"get"|"set",signal?,reply}`。

`BoulderClientResult = {ok:true,snapshot} | {ok:false,failure:{message:string,cause?:unknown}}`。service response同型。get/set方法返回此Result，不再throw原error；snapshot/信号格式不变，原cause可被调用者检查。

`BOULDER_INHIBITION_READY_CHANNEL="omp:boulder:inhibition-ready:v1"`，通知`{session}`，只弥合adapter/loop初始化次序，不保存抑制状态。内部binding只有OMP提供的port/effects，外部生产者不提供cancel/UI能力。

## 2. register / handler / handleRequest

### `registerBoulderInhibitionService(bus,resolveSession): () => void`

caller：OMP adapter setup、tests。callee：bus.on。Requires：上述bus/单provider合同。正常注册一次，返回原disposer；setup API失败可抛，不能宣称已注册。注册期间不碰branch、不取消等待、不输出info；无顶层注册副作用。

### 注册的 `handler(data): void`

非object/null/array或reply不可调用→返回，无resolver/port/effects。可回复请求在try内提取reply并调用handleRequest；异常→前缀化描述+cause失败结果；没有可提取reply则不回。reply调用另有try/catch，失败只安全诊断，不重回、不让异常进入EventBus。有限步骤，无循环；成功/非法/不可用/内部失败/回复失败全部明确退出。

### `handleRequest(data,resolveSession): BoulderClientResult`

caller：handler。无有效session object/op→invalid失败；set信号parse失败→invalid失败，get忽略多余signal。parse的类型不变量见独立函数合同。

有效参数→try resolveSession；undefined→session unavailable，无I/O；binding→get读branch再read，set调内部writer；正常返回success snapshot。resolver/read/write/输出任一步抛→failure message/cause，不重试、不撤销已经写入的信号。parse或property getter在该内部try之外的错误仍由handler外层catch承接。诊断辅助不把未知异常值再次转换成throw。

组合论证：参数分支建立resolver/read/write入参；resolver给正确port/effects；其callee post给snapshot；两层catch涵盖参数及I/O的失败；reply在单独catch中，故不会把reply故障误当原操作失败二次回复。

## 3. client factory / invoke / get / set / reply

### `createBoulderInhibitionClient(bus,session): BoulderInhibitionClient`

捕获当前bus/session，仅构造闭包，无立即emit/on、无缓存。get/set不依赖this。

### `invoke(operation): BoulderClientResult`

本调用容器初为空，构造request；try内emit一次后检查同步reply。空→service unavailable；failure→保留同一failure；success→该success结果。emit与结果属性处理的异常都转safe message/cause，不重试，不返回假成功；操作可能已经写入，不能声称回滚。

reply闭包只保存第一条本调用结果；迟到reply只影响已退出的容器，不修复之前返回失败、不影响下一次调用。get/set只选择operation，完整保证由invoke承接。无await，不支持异步provider。

## 4. 诊断与组合承接

`describeThrown`尝试Error.message或String，失败给固定fallback；`reportBoulderDiagnostic`尝试console.error一次，logger失败返回，无显示必达保证。handler reply catch使用两者，不能把console默认不会抛当作前提。

writer/check仍是可抛内部callee；service和scheduler持有实际外围。execute/sync保留Result，sync也捕获外部client调用失败。对象聚合成功与未完成错误不混写；type、branch、scope规则见D.root和独立合同。

## 5. 验证状态与界限

直接测试包含原异常/非Error、迟到回复、无provider、写后不回滚、输出/日志失败与真实EventBus；测试计数按delivery当前结果，不引用旧125测试认证后来的入口。旧CCA覆盖旧源，本轮增量CCA将纳入adapter、UI/命令/timer/补全及调用闭包。

无跨进程、无provider discovery registry、不承诺任意旧ctx可写，不自动raw-append fallback。真实加载/TUI/用户验收尚未发生，初始化失败与进程终止不假称正常运行。
