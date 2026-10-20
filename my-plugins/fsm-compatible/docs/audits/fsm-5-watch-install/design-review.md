全部缝核完：normalizer 对非前缀名原样透传、FSM 投影工具跳过 check(与 hook 跳过 FSM 工具一致)。以下为完整设计确认报告(无写工具，按运行时约定以最终回复交付，由 runtime 持久化到绑定输出路径)。

---

# fsm-5-watch-install 编码前设计确认(workflow §4.4 六项标准，限定 B9 及直接缺口)

结论：**READY——可以开始编码(0 blocking)**;3 项 P2 澄清建议，不阻塞。
范围纪律：未重审 fsm-1/2/3/4 结论；未新增审查目标、provider 测试、OS sandbox、GUI 要求。全程严格只读，未执行命令、未调 provider/daemon,每轮 ≤2 文件。

## 一、B9 闭合核对(原审查最小修正 vs 叶子合同)

原审查 `audits/design/design-review-initial.md:174-181` 要求：定义 session-owned 任务问答标记及设置/清除者；将实际开始/回答/取消/恢复接到 suppress/release;补 print/headless 输入结束合同；只承接现有问答通道，不新增 mandatory AskUserQuestion 工具或 GUI。

叶子 `subplans/fsm-5-watch-install.md` §2 逐条闭合：
- 标记与生产者:`waitState:{active,since,question}` 存 root runtime;设置者仅 ask 工具执行，清除者为 ask 返回(POST ask-end release)与任何其它 main 工具完成(permission-gate 每次 verdict 后按二分移 gate)。二分规则与 hook 一手源逐字一致:`use-fsm/crates/hook/src/main.rs:435-449` `gate_should_suppress = allowed && is_question_tool`,仅 "AskUserQuestion"(:419 注释明示 external premise);lost suppress 欠抑制(安全)、lost release 下一次 main 工具自愈(:450+ 文档字符串)。leaf §7 要求枚举 allowed/denied × AskUserQuestion/other 的性质测试，与之一一对应。
- daemon 侧合同核实:`use-fsm/crates/server/src/api.rs:186-187` 两路由存在且注释明示 exempt from `resolve_and_lock`(插件 gate POST 不与身份层互撞);`GateRequest{session_id, agent_id, reason}`(:2202-2208),`is_main` 守卫使 child 写入无效(:2212-2219),约定 reason 值恰为 ask-start/ask-end/main-tool-start——ask-end 作为路由合法值已被 daemon 文档确认，插件作为生产者成立。
- 取消/普通输入/headless:ask 返回含回答/取消/错误三出口；普通用户输入仅在 `waitState.active` 时结束等待；无 UI(print/rpc 无 dialog)时以 input 通道或返回“不可用”错误，不伪装回答；无问答能力则不注册工具。`ui_prompt_start/end` 明确降级为输入通道事件、非问答语义源——与原审查“相同 input/editor 不能从 kind 推业务语义”的批评直接对应。已核 pi-coding-agent 1.0.3 类型:`ctx.ui.select/confirm/input`(`types.d.ts:74-78`)、`ui_prompt_start/end`(`:1175-1176`)均存在,可编码。
- 边界合规：工具可选注册(非 mandatory),无 GUI/沙箱/provider 新要求。

## 二、直接同合同缺口闭合核对

- **Watcher 真实投递**：现状 `src/protocol/oc-handlers.ts:76-83` promptAsync 为显式 503 桩(注释 "fsm-5 owns the real bounded delivery queue"),本单元接真实 AdvisoryQueue;目标树内校验经既有 binding,满/失效 503、树外 404、入队副作用后才 204——与 `architecture.md` §4.8 “收妥才发 204/不误报 void 返回为同步确认”一致。drain 用 `pi.sendMessage(customType/content/display/details,{triggerTurn})`,1.0.3 签名支持 details+triggerTurn(`types.d.ts:1221-1224`);scheduled→consumed 仅以真实 branch 记录投影为准，failed 保留不静默重发；旧 owner 遗留 failed 不转投。idle 判定有真实生产者:`isIdle()`/`waitForIdle()`(`types.d.ts:236,290`)。
- **恢复**：capability→source 读回→Client/catalog 重建复用 fsm-2 `prepareBrokerChannel`;source-auth 路由在 daemon 侧存在(`api.rs:190`);未知 mutation 不回放、owner 不可确认即拒绝——与 detailed-design §5.6 `recoverRuntime` pre/post/证明一致。
- **组装 openOwnedRuntime**:fsm-2 的 bootstrap/broker-channel/not-ready-gate 与 RootHealth.markPrepared 均为已 PASS 组件；全部 prepared 才 ready、失败逆序释放；fsm-4 两项记录级残留(排队 signal 复查、launch 级用例)明确入本单元。
- **helper allowlist**:leaf §1 明示 `/gate/suppress|/release` 加入固定 allowlist(现 `daemon-request.mjs:16-19` 尚无 gate 路由，属待实现而非缺口)；每请求新 token、读实际响应、best-effort 不以 exit0 推断保持。
- **planInstallation**:静态解析、显式列 ~/.pi 建议不自动改、cc 显式无 npm lifecycle、无 token 消耗——与 detailed-design §5.6 及既有 §9 安全边界一致。

## 三、六项标准逐项判定

1. **架构正确性论证就位 — PASS**。goal→组件映射明确(§1/§5);裁决/调度权留 daemon、插件只拥有接收/投递/标记事实的所有权划分与 architecture §4.8/接口表一致；关键假设显式(AskUserQuestion 命名为 host 外部前提、ui_prompt 非语义源、无 UI 探测)。
2. **细化文档结构就位 — PASS**。范围/复用(fsm-1/2/3/4 直接复用)/错误处理(best-effort、503/404/failed、聚合释放)/数据结构(waitState、AdvisoryDelivery 四态、安装计划 ready/blocked)/模块细化/自检与测试计划(§6)/退出(§7)齐备；编号风格与前三个已 PASS 叶子合同一致。
3. **细化完整性六条全过 — PASS**。推导连续(P1 ask 链、P2 verdict 二分、P3 队列-drain-consumed、P4 恢复);分支覆盖(问答三出口、gate 2×2 枚举、队列满/404/503、drain 四态、恢复确认/拒绝、无 UI);退出覆盖(gate 失败放弃不重试、close 清队、未知不回放);callee 契约引用带一手源(本轮逐条复核属实)；循环刻画(drain 逐项、owner 取消停止、队列有界)；假设链显式。
4. **函数正确性论证就位 — PASS**。父 detailed-design §5.6 四函数均有 pre→post→证明；叶子补 B9 标记生命周期的设置/清除者唯一性论证。
5. **函数设计满足功能/接口规约 — PASS**。GateRequest 三字段、is_main 守卫、reason 值域、路由豁免身份锁、pi 1.0.3 sendMessage/ui/isIdle 能力、normalizer 对非前缀名原样透传(`tool-normalizer.ts:44-46` default 分支)且 `isFsmProjectedTool` 仅匹配 `mcp__fsm__` 前缀(:50)——FSM 投影工具跳过 check 与 hook 跳过 FSM 工具的行为一致(:451 附近 "rides the critical path of every non-FSM tool call")。
6. **文档无歧义可直接实现 — PASS**(附下方 P2)。

## 四、Findings

**P2-1(澄清，建议编码前一句话钉死)** leaf §2 中 ask-start suppress POST 的发出者读法:`permission-gate 对 main 每次 verdict 后按二分规则移动 gate` 已涵盖 allowed×AskUserQuestion→suppress(ask-start),ask 工具只置 waitState 并在返回时 POST ask-end;不应实现为 ask 工具再补一次 suppress(与 hook 在 verdict 时点移 gate 一致，重复 suppress 同向无害但偏离“与 CC hook 行为一致”)。一处明确即可消除双读。

**P2-2(澄清)** drain 的 "目标会话 idle" 建议在实现时指明生产者为 `ctx.isIdle()`/`waitForIdle()`(1.0.3 已具备)；父合同 §5.6 只要求 owner active,叶子新增 idle 维度，宜在测试计划中给出对应用例锚点。

**P2-3(记录级)** gate 移动对 FSM 投影工具的跳过目前由 `isFsmProjectedTool` 早退推导出，叶子未显式写一句；实现时随 P2-1 一并写明即可。

以上均不构成阻塞；无违反原合同、无 scope 降低、无未定义生产者。

## 五、边界与退出确认

- fsm-1/2/3/4 结论未重开；fsm-2 最终 contract 对照按其绑定路径并行，不并入本报告。
- 本单元 READY 不等于全系统完成：真实模型 E2E、SA 集成烟雾属安装后验证，须账户/预算明确；P10 mandatory 命令翻译保持后续责任。
- 实现 后仍须全量直接测试 + 一次独立合同对照。