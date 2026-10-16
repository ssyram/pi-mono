# Boulder inhibition — Task Overview 与 Q

本专项交付 loop 特殊 schedule 存续期间阻止 Boulder 的运行功能，含 branch-local 多来源日志、跨插件服务、人工命令与补全。

工作边界：早期用户要求独立实现后才接入，原要求和来源保留如下；当前源码已有接线，用户随后要求补全全部自动补全、更新所有 QPDI 文档并增量执行 CCA。当前源码是否已被运行中的 Pi 加载未知，用户保留实际加载/验收与提交/发布权；不自动 reload、不提交。直接测试属于实现职责，只有本轮增量 CCA 获授权，不追加其他审查。

导航：[设计与组合论证](design.md) → [函数级合同与测试接口](function-contracts.md) → [逐文件/函数交付与运行依据](delivery.md)。

## Q.I — confirmed：用户已明确的正确性与边界

### Q.I.1 对象存续期抑制

指定的 scheduled task 生效期间，当前 session 的 Boulder 不得自动启动；不以是否刚收到一次唤醒为边界。任务不再有效时，生产者应撤销自己持有的抑制。

来源：用户“某些任务只要它 schedule 了，就默认不启动任何 Boulder”“只有这些东西在的时候才留存这个信号，不在了马上 close 掉”。由 D.root 回答。

### Q.I.2 多来源不互相解除

一个来源解除阻止不得解除其他仍然有效的来源；用户可以手动修改指定来源的值，包括清理残留信号。

来源：用户“gather 所有 type 的结果，只要存在一个结果是 true”“/task boulder set XX t/f”。由 D.root 回答。

### Q.I.3 解释实际判定

每次 Boulder 检查输出 info；若因抑制信号停止，应列出全部当前阻碍来源，而不只显示一个布尔值。

来源：用户“Boulder 每次检查完就打印一个 info”“如果被 stop 了就打印所有阻碍 Boulder 的 type”。由 D.root 回答。

### Q.I.4 接入保留人工批准

早期独立阶段须保持未接入，用户保留最后接入批准。当前入口虽已存在，不把 AI 的源码接线、测试或审查完成当成用户已加载/验收；实际批准和发布仍须有用户明确依据。当前反馈要求继续补全及增量验证，不授权自行 reload 或代签验收。

来源：用户“实现测试都不要接入主线程”“我最后批准了就接入”。由 D.root 的隔离性质回答。

### Q.I.5 跨插件调用不转移内部运行责任

其他插件可以设置自己的抑制来源，但不应为此持有 Boulder 的内部等待状态或承担它的诊断副作用；不能把未提供服务或执行失败报告为成功，也不能操作错误的 session。

**公共插件边界在运行中绝不向 Pi 抛出异常**（用户裁决：“公共插件在运行过程中绝不能抛到 pi 框架中，否则就要炸了。这是核心。”）：对其他插件/宿主回调可见的 API 以结果对象返回失败，保留原因与“副作用可能已发生”事实；内部函数可用异常，由拥有边界的代码捕获并转换。

来源：用户“其他插件也要写的吧”“直接将函数调用 handler 放公用频道”，随后授权 Result 化并确认无异常外抛为接入硬前提。由 D.service 回答。

## Q.A — 本设计使用的事实前提

### Q.A.1 branch 的顺序和隔离（verified）

`packages/coding-agent/src/core/session-manager.ts:getBranch` 沿当前 leaf 的父链收集 entry，再 reverse，结果为根到当前叶的顺序；不是全部 session 文件记录。custom entry 不进入模型上下文；custom message 会进入。

使用方：D.read 的最新值算法及 D.root 的存储选择。

### Q.A.2 后台工作还有其他消费者（verified）

`hooks/boulder-background-work.ts` 读取 subagent/background work；`third-party-plugins/pi-subagents/src/runs/background/auto-drain.ts` 也读取 background-work snapshot 作为等待退出条件。

使用方：D.root 的 R：不能为抑制 Boulder 把长期定时器冒充执行中的后台工作。

### Q.A.3 loop 有独立的定义、进度与注册有效性（verified）

`scheduled-wakeup/src/v2/model.ts` 区分 active/completed/expired、session task 和 shared registration；定义现已含可选 boolean `inhibitBoulder`。`definition-store.ts:registrationStatus` 区分 indexed/missing/unavailable。

使用方：D.integration.loop；定义存在不等于当前 session 已启用，catalog 不可读不等于已失效。

### Q.A.4 Pi 事件总线的调用语义（verified）

`packages/coding-agent/src/core/event-bus.ts` 的 emit 返回 void，通过 Node EventEmitter 同步分派；on 的安全包装捕获 handler 异常并打印，不把返回值或异常交给 emit 调用者。`extensions/loader.ts:loadExtensionsInternal` 向同批扩展提供同一 eventBus。只有共享同一个 bus 的插件可通信，不能推出跨进程或全局共享。

使用方：D.service 的同步 request/reply、原异常转发与 unavailable 判定。注册的服务 handler 必须在 emit 返回前调用 reply；不能把未来异步 handler 当成已兼容。

## Q.E — 本讨论中实际发生的范围误读（verified，一次观察）

最初把需求设计成单次唤醒携带信号，用户明确纠正为 schedule 存续期抑制。它支持本设计把对象有效性与消息交付分开；不据此发明其他调度目标。

## 尚未证明的运行边界

旧 CCA 仅覆盖当时的独立模块，不能证明后加的接入/补全代码。当前直接测试和增量 CCA 各有版本与范围；真实 Pi 加载、TUI 和用户验收尚未发生，不能宣称端到端已获验收。
