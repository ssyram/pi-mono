# D.root — loop 存续信号控制 Boulder

目标：特殊 schedule 存在时当前 branch 的 Boulder 不续跑；人工与多个插件可独立设置信号；公共运行边界不向 Pi 抛异常。入口已有接线，本轮验证尚未完结，当前 Pi 进程是否加载新代码不作假设。Q 与来源见 [principles.md](principles.md)。

## P — 整体可判定性质

1. 当前 branch 从新到旧，每个 type 取最新有效 boolean；false 也消耗该 type；任意 true 阻止并报告全部阻止 type。
2. set 只影响自身 type。人工写入与生产者同权，最后写生效；人工改 loop 值不是永久 override，下次同步按真实对象重算。
3. loop 值 iff 当前 session 有 active、inhibitBoulder=true 且已确认有效的 schedule。共享定义未注册不计；catalog 不可读不伪装成 missing 或 false。
4. service set append→重读→条件 cancelWait→info；写后任何失败不伪称回滚。Boulder 安排与实际发送前重读；解除信号不主动触发新回合。
5. 公共 command/event/tool/timer/service/completion 的运行失败在 owning boundary 消解；异步委托必须在 try 内 await；错误描述和诊断失败不得再次抛。正常资源/SDK入参条件下保证，不冒充可处理进程被杀/OOM。
6. runtime/服务操作当前会话：对象身份与 session ID 配对，同 cwd 不能复用旧 core；旧不可访问会话不得用 pi.appendEntry 写当前会话。SDK 已过期 ctx/client 不允许复用。
7. 不注册 background work，不改 task gate，不注入模型消息，不维护独立抑制缓存，不改 Pi 官方源码。任务状态、人工输入和 subagent 不因抑制被取消。

## M — 责任分配

| component | 分配合同 / 叶子 |
|---|---|
| D.signal | 统一 decoder、branch OR、内部 write/check；[function-contracts.md](function-contracts.md) |
| D.service | 同步 session-bound get/set→Result；[service-contracts.md](service-contracts.md) |
| D.integration | adapter、scheduler、task 路由、loop runtime/工具/同步、补全外围；[integration-contracts.md](integration-contracts.md) |
| D.delivery | 当前源版本、测试、CCA回执、未完边界；[delivery.md](delivery.md) |

组合：CLI或工具创建带标记定义→core持久化→mutation/afterRun/恢复/branch刷新→bridge重算→client→OMP当前binding→日志→scheduler门。服务就绪通知只补偿两个插件启动顺序，不保存信号；set后的取消仍归OMP。

## 服务及持久数据

日志：`customType="OMPv2InhibitBoulder"`，data `{type:string,value:boolean}`；type 非空无空白、大小写敏感，额外字段忽略，invalid不覆盖有效旧值。只读get不打启动检查info。

请求频道 `omp:boulder:inhibition:v1`：`{session,op:"get"|"set",signal?,reply}`。成功 `{ok:true,snapshot}`，失败 `{ok:false,failure:{message,cause?}}`，必须emit返回前reply；无提供者不是成功。就绪频道 `omp:boulder:inhibition-ready:v1`：`{session}`，只有当前loop runtime参与同步。

## R — 推导、组合与取舍

Q.I.1要求对象聚合与lifecycle同步，Q.I.2要求type独立最后写，Q.I.3要求真实检查info，Q.I.5要求本地catch与Result而非Pi吞错。branch顺序、SDK context时效、EventBus同步分派为Q.A。Q.I.4仍保留用户的实际加载/验收与发布权，不用测试通过代签。

decoder/read的后缀Map不变式建立唯一最新值；writer只append该type，保证兄弟独立；service提供有效signal及正确binding；client/execute/sync的异常变Result；运行adapter与命令/定时器再承接内部I/O/展示失败。两个completion provider的fallback await防止Promise拒绝越过catch。这些叶子组合满足上列P，实际证据仍须来自测试和当前版本增量CCA。

直接O(N)扫描成本相对LLM已被用户确认可忽略，保留无缓存。公共服务比外部提供OMP私有cancel/UI能力责任更短；就绪通知只消除已知初始化次序缺口。没有新的审核轮次或通用服务registry。

## 运行边界

信号不会自动过期：漏写false、写后失败、远程强删尚未被当前session发现可残留，用户可手工set。已投递/排队提示不可撤销。共享存储更广的durability/cache/lease保证见loop既有文档，不据本功能catch宣称已修复。尚未完成当前增量CCA、真实reload/TUI验收和提交。
