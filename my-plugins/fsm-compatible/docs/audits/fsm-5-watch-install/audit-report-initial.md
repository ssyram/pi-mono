材料核读完成(13 个文件直读，expectations 沿用本会话既有全文)。写最终对照报告(无写工具，按运行时约定以最终回复交付，由 runtime 持久化到绑定输出路径)。

---

# fsm-5-watch-install 实施后独立 Contract 对照报告(路径 B)

判定：**BLOCK(1×P1,其余为 P2)**。P1 为组装失败回收集合的一个残余窗口 + 对应“失败逆序”计划测试缺失；最小修复明确、其余实现与 expectations 逐节吻合。

对照基础：expectations 十节全文(本会话直读过原文)；13 个实现/测试文件直读；测试报告 fsm-5-watch-install.md。未读 implementation.patch,未执行命令，未调 provider/daemon。

## 一、已确认正确(逐节证据)

**§4 P1-P4 与 Step Pn**
- P1(suppress→问答→结果→release):suppress 在 permission verdict 时点由二分发出，先于 ask 工具 execute 内的 dialog 等待；ask 工具只拥有 waitState 与 ask-end(`ask-tool.ts` 头注释明示分工，实现与设计确认钉死句一致;`watch.test.ts` 断言 ask 全程 posts 恰为 ["/gate/release"]、等待期间 waitState={active:true,since>0,question}、回答后 active=false)。
- P2(每次 verdict 二分移 gate):`permission-gate.ts` verdict 后 `gateShouldSuppress` → `void moveGate(..., suppress?"ask-start":"main-tool-start")`;Step P2 注释在位；FSM 投影工具同时跳过 check 与 gate 移动(注释显式，设计 P2-3 已闭)。
- P3(入队→204;drain→sendMessage→branch 可见→consumed):`oc-handlers.test.ts` 断言 204 空 body 且响应时队列已含条目;`drain-advisories.ts` 先以真实 branch 谓词标 consumed、再对 idle 目标以 `sendMessage({customType:"fsm-compatible:watcher",details:{deliveryId},triggerTurn:true})` 投递。
- P4(身份确认→重 prepare→source-auth 刷新;未知 mutation 不回放):`recover.ts` 前置 rootSessionId 确认、复用 `prepareBrokerChannel`、POST `/evidence/source-auth` 刷新桥密码；无任何重放路径。
- Step Pn 注释:P2 在 permission-gate 在位；ask/drain 文件用描述性注释承载流程但无字面 "Step P1/P3" 标签(见 P2-4)。

**§5 行为**
- gate best-effort 不改 verdict:`moveGate` 吞错、child(agentId≠main)直接 no-op;`gate-moves.test.ts` 断言 gate POST 抛错时 tool_call 仍按原 verdict 返回、child binding 对 /gate/* 直接 throw 仍通过。
- 满 503/树外 404/严格 204:HTTP 层三态 + shape 400 + 未接线 503 桩用例保留(无削弱)。
- 旧 owner 不转投/close 清队:`AdvisoryQueue.close()` failAll+拒收(owner-unavailable);`markScheduled` 仅 accepted→scheduled 单向(重复抛 not-ready),同 deliveryId 不重发。
- consumed 仅真实 branch:`drainOnce` 以注入 `consumed` 谓词(store 分支中 custom_message.details.deliveryId)为准；测试断言 consumed 后出队、发送异常 failed 出队(failed 可观察、不静默重发)。
- fsm-4 残留补齐:`root-launches.ts` 出队后副作用前 signal/deadline 复查(注释明示)+ delivery-unknown/cancelled 路径 `runs.forget`;`child-runs.ts` forget 释放容量保留 unknown 可查。
- 安装静态:`plan.ts` 纯 exists 检查，blocked 具体化，piConfigSuggestions 显式 "never edits ~/.pi"(测试断言)，无任何写入/lifecycle 执行/token 消耗(modelRuntimeNote 显式授权边界)；wire2+schema2 门槛声明。

**§6 时序**:suppress 先于等待(verdict 时点)、release 后于结果(finally)、204 在入队副作用后、恢复同 SID 同 actor 不新增字段——均核实。

**§9 安全**:gate 两路由入固定 allowlist(`daemon-request.mjs`),仍每请求新进程读新 token、stdout 无 secret;Watcher 文本按 parts 原样拼接投递、不做密级改写;`index.ts` 根入口失败仅 notify,不改外部源码。

## 二、Findings

**P1(BLOCK 项)组装失败回收集合的残余窗口 + 失败路径测试缺失**
- 位置:`src/runtime/owned-runtime.ts`。catch(health.close → gateOffs 逆序 → resources.close)从 `try {`(prepareBrokerChannel 起)才开始;其前已执行的 `RootLaunches.openScope()`、not-ready gate 安装(gateOffs.push)、`await server.listen()` 若本身抛错，不经任何回收：not-ready gate 残留为已安装的 pi handler、launch scope 临时目录泄漏、listen 部分成功后抛错时桥 socket 残留挂进程——恰是测试报告自述“修复了失败不回收桥资源挂进程”要消灭的故障类，仍在更窄窗口存在。
- 违反:expectations §7 “组装失败零残留 handle”;叶子 §5 “任一失败逆序释放并 not-ready”;叶子 §6 测试计划 “组装 smoke(faux 全链 ready/**失败逆序**)”。`assembly.test.ts` 仅覆盖成功链，无失败逆序用例。
- 最小修复：把 try 起点提前到 openScope/gate 安装/listen 之前(或将 gate off 与 scope/listen disposer 先行登记进 resources 并对 listen/openScope 包 try→resources.close 后重抛)；补一条组装失败路径测试(注入 listen/openScope/prepare 失败)，断言 ready=false、gateOffs/resources 全回收、无残留监听与临时目录。修复+测试后本项即可闭合。

**P2(记录级，不阻塞)**
1. `index.ts` session_start 重入时直接覆盖 `handle`,未先 close 旧 runtime(依赖旧 session 的 session_shutdown 触发)；若 Pi 会话切换不保证先 shutdown,旧桥/通道滞留。建议重入时先 `await handle.close(...)` 再重建。
2. ask 工具无条件注册：expectations §5 “无 UI 时不注册 ask 工具” 的字面分支未实现(UI 能力在 execute 时检测、返回 isError “不可用” 兜底——叶子允许的回退分支，安全语义“不伪装回答”已守住)；组装测试证实无 UI ctx 下工具仍被注册。安装计划的 "prompt 能力声明” 亦无对应物。
3. drain 接线仅对根 session 生效(`isIdle: target===sessionId ? ctx.isIdle() : false`),树内 child 目标的投递将停在 accepted 直到 close→failed;叶子允许树内目标，daemon 实际投递目标分布未证实，记录为功能边界。
4. ask-tool.ts/drain-advisories.ts 缺字面 "Step P1/P3" 注释(流程语义已在注释与测试中，违背 expectations §4 的字面要求)。
5. `plan.ts` 相对叶子 §5 枚举缺 “managed bootstrap 入口生成(manifest)” 步骤，npm 步骤未提 overrides;现 index.ts 为内置单 factory,companion manifest 生成留空。
6. 恢复测试证据薄：recover.ts 实现符合 P4,但测试报告 115 项分解(gate-moves 4+watch 3=watch 7)未见 recover 专项用例(身份不变/不重放/重注册)——叶子 §6 计划内的 recover 测试未见运行证据。

## 三、测试覆盖与无削弱

- gate 二分 2×2 穷举、best-effort/child/FSM-skip、队列状态机/容量/close 语义、ask 等待三出口、drain 恰一次/失败出队、HTTP 三态、组装全链 smoke(桥 401、投影工具真实执行、close→not-ready)、安装计划三性质——均有直接断言；既有 503 桩用例与旧单元回归保留，未见删除或弱化。
- 缺口仅上述 P1 失败路径用例与 P2-6 recover 用例。

## 四、结论与解除条件

实现主体与事前 expectations 一致，B9 闭合质量良好;P1 为单一、定位明确的失败回收窗口。按“0 critical/unresolved 方可 PASS”的既定标准，当前 **BLOCK**。补齐 P1 的两点(try 边界提前/disposer 前置登记 + 失败逆序测试)后可复检改判 PASS;P2 各项可作为修复 P1 时顺手处理或留待 P10 前清理，不构成放行条件。