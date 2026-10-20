# CCV Pi mock 主体 232 秒延迟调研

## 结论

主要原因是 **fsm-compatible 错用了 FSM identity 协议**，不是 mock 模型慢，也不是 Pi child 必然需要 20 秒冷启动。普通权限检查前多余的 `/identity/acquire` 会留下不被消费的槽位；同一宿主、同一工具再次 acquire 时，服务端等待旧项的 10 秒 TTL。主线程与 child 都受影响。

调研阶段仅运行隔离实验并保存证据，未修改生产源码。用户随后授权的代码修复见第8节；原版剧本及既有服务均未修改，未调用真实模型。两次主 FSM 转移内部的 38.3 秒尚无原始分阶段计时，不将其擅自归因于编译/缓存，也不承诺修复后的完整运行秒数。

## 1. 研究对象与边界

- 主样本：`pi-v3-20261020-143605`。`rounds.jsonl` 首个 main-step 为 `2026-10-20T06:36:30Z`，最后为 `06:40:22Z`，相差 232 秒。
- 后续样本：`pi-v3-20261020-161635`，旧报告称主体 292 秒；用于检查相同延迟模式是否持续，不与旧样本混为同一流程版本。
- 参考样本：`smoke-v3-20261016-v3-2`，首末 main-step 相差 19 秒。日期、剧本与 gate 版本不同，只是时间线参考，不是严格同版本 A/B 性能基准。
- v3 的 endpoint 保留 main 在 `V_A_LOOP`；不是验证完整 15 态到 `V_DELIVER`。
- endpoint 后 stop-gate 空转不在本次 232 秒主体窗口内，不能解释主体延迟。

原始记录根目录：
`/Users/ssyram/workspace/work-fv/c-code-verify/.local/ccv-caller-callee-closure-v1/tests/mocker/run/`

主 Pi session：
`/Users/ssyram/.pi/agent/sessions/--Users-ssyram-ccv-verify-ccv-pi-143605--/2026-10-20T06-36-12-764Z_01a15806-565b-7180-b71b-bb906c4ecc93.jsonl`

Child Pi session：
`/Users/ssyram/.pi/agent/sessions/--Users-ssyram-ccv-verify-ccv-pi-143605--/2026-10-20T06-38-43-908Z_01a15808-a4c3-77f9-a04b-694ffe4ee201.jsonl`

## 2. 232 秒的分账

从 Pi session 的 assistant 消息、toolResult 时间和工具 `durationMs` 重建 30 个主线程工具批次。累加业务执行与相邻回合约 232.6 秒；与 rounds 的首末 main-step 232 秒口径相差亚秒级/末尾执行时间。

| 不重叠的主线程时间段 | 秒 | 说明 |
|---|---:|---|
| 主线程工具 execute 之外的等待 | 116.572 | 主要是权限 hook，包含少量准备/收尾开销 |
| 主线程实际等待 child 执行 | 68.911 | 两个等待命令 execute 时间；不含自身 hook |
| 两次主 FSM 转移 execute | 38.252 | 20.126 + 18.126；内部细分缺记录 |
| 其余工具 execute | 3.993 | 读写、命令、FSM 状态等 |
| 模型调用及批次间其它间隔 | 4.909 | 不是纯模型推理时间统计 |
| 合计 | 232.637 | 无 endpoint 后空转 |

Child 的调用前等待区间与主线程上述 68.911 秒的等待 execute 区间取交集，约 **61.732 秒**。这避免把主、子并发等待重复累加。它与主线程 116.572 秒属于不同的关键路径区间，合计约 **178.3 秒（77%）** 落在调用前等待，而不是工具业务执行。该数包含少量非槽位准备开销，不冒称每毫秒都已经归因。

### 直接样本

| 工具结果 | assistant→结果墙钟 | 工具 execute 自报 |
|---|---:|---:|
| 首个 read `call_smoke_0` | 10,140 ms | 2 ms |
| main write `call_smoke_17` | 9,769 ms | 1 ms |
| main write `call_smoke_18` | 9,860 ms | 3 ms |
| child write `call_smoke_13` | 9,887 ms | 1 ms |
| child write `call_smoke_14` | 9,864 ms | 2 ms |

安装版 Pi 1.3.0 `pi-agent-core/dist/agent-loop.js:493-494` 在 prepare 阶段 await `beforeToolCall`；`:571-579` 在后续 execute 阶段才开始记录 `durationMs`。因此这些大间隔不是文件读取/写入本体慢。

## 3. 协议根因：写入后没有消费者

### 修复前插件路径

- `src/gates/permission-gate.ts:18-23`：每个普通工具的 check 请求附带 identity payload。
- `src/broker/daemon-request.mjs:30-44`：helper 先 POST `/identity/acquire`，等待成功后再发实际 `/check-permission`。
- `src/process/read-json-process.ts:36-40`：父进程等待 helper 退出，故阻塞直接反映在工具调用前。
- `src/gates/stop-gate.ts:26-35` 同样在 `/stop-check` 前写入 identity 槽，重复 stop 时也会产生同类问题。

### 真实 runtime 源码

以下路径相对本次使用的 runtime 源码：
`/Users/ssyram/workspace/work-fv/c-code-verify/.local/fsm-runtime-caller-callee-closure-v1/source/`

- `crates/server/src/session.rs:25`：`IDENTITY_TTL = Duration::from_secs(10)`。
- `session.rs:92-117`：`PendingIdentity::put` 遇同键 fresh entry 时等待剩余 TTL。键为 `(AgentKey, published tool name)`，不是每个 helper 的临时 PID。
- `crates/server/src/identity.rs:55-105`：从连接 peer 的父进程寻找实际 agent；同一 Pi 派生的多个 helper 解析到同一 Pi host。
- `crates/server/src/api.rs:2111-2186`：`handle_identity_acquire` 写入该槽。
- `api.rs:2690-2713` 注释和 `handle_check_permission` 函数：check-permission 是独立 hook API，直接使用 body 中的 session/agent，不消费 pending identity。
- `api.rs:790-824`：需要该槽并消费它的是 MCP/client API 的 `resolve_and_lock`。

错误调用链：

```text
普通 Read #1
  identity/acquire(Read) -> 留槽
  check-permission(body已有sid/aid) -> 放行但不取槽

普通 Read #2（同一Pi宿主）
  identity/acquire(Read) -> 同键槽仍fresh -> 等到10秒TTL
  check-permission -> 放行
```

这也解释了“换工具名时很快、同名连续调用时接近整10秒”、同批两个 Read/git show 先等权限准备后才共同返回的现象。

原生 OC hook `crates/hook/src/main.rs:480-493` 直接调用 `/check-permission`，没有在普通权限检查前写 pending identity；这不是 OC 固有的开销。

## 4. 隔离真实二进制对照实验

使用与 smoke 相同路径的二进制：
`.../.local/fsm-runtime-caller-callee-closure-v1/oi/bin/mcp-server-fsm`

实验由 Node v26.8.1 启动一个全新临时 data-dir daemon；使用生产原版 `daemon-request.mjs` 发请求。测试 session 仅位于这个隔离 daemon 的默认状态，返回均为 HTTP 200/allowed=true。没有连接、停止或修改既有 daemon。实验结束后仅关闭自己持有的 daemon 进程并删除自己的临时目录。token 未输出。

| 请求序列 | 是否在 check 前 acquire | 耗时 ms |
|---|---|---:|
| Read #1 | 是 | 145.23 |
| Read #2 | 是 | 10,005.82 |
| Write #1 | 是 | 324.30 |
| Write #2 | 是 | 9,946.71 |
| Write #3 | 是 | 10,004.87 |
| Read #3 | 否 | 120.66 |
| Read #4 | 否 | 114.15 |
| Read #5 | 否 | 128.11 |

补充对照：同一实验进程不经 helper、直接请求权限 API，三次合计 11.39 ms。另用即时返回的本地 HTTP Unix-socket fixture 调原版 helper 三次，helper 从启动到退出约 131–147 ms，排除了 helper 自己固定等10秒退出的假说。

由此证明：十秒主要来自真实 daemon 的 identity slot 背压，而不是 mock 的网络或脚本 sleep，也不是 Node helper 固定生命周期。

## 5. Child 不是20秒冷启动

主样本 child session 创建：`06:38:43.908`；首次 user：`06:38:44.874`；首次 assistant：`06:38:45.031`。会话创建到首条模型回复约 **1.123秒**。后续样本同口径约 **2.177秒**。

主样本 child 的 `git_show` 同批两次 Bash，命令本体各25–26ms，结果直到 `06:39:06.297` 才一起返回；之后 ready.txt 的 write 本体1ms，却有8.965秒调用前等待。后段连续稿件 write 每次又等约9–10秒。这些延迟使 main 的等待显著拉长；不是 child 启动本身花20秒。

本轮还确认旧解释中的另一项误读：`session.rs:181` 的 **DISPATCH_TTL 为1800秒（30分钟）**；`:185` 的10秒是 `DISPATCH_POLICY_ACTOR_TIMEOUT`，即派发前只读actor查询预算。此前“dispatch 队列TTL只有10秒，因此必须预claim”的论证错误；现有预claim机制是否保留应另按真实身份/握手合同判断，本轮不擅改它。

## 6. 尚未细分的38.3秒与比较边界

主样本两次 transition execute 分别20.126秒、18.126秒，这部分确实在 FSM 调用内部，不是普通工具 permission hook 的直接计时段。原始记录无各 hard-check/evidence/review/commit 的独立起止点，因此不能判其全部为clightgen、冷缓存或正常成本。

后续样本的 transition execute 合计76.690秒，更不能用同一个“固定结构成本”解释。它需要在隔离复现里对 MCP transition 的 prepare、每个 hard gate、evidence、review、commit 分段计时。最短顺序应先修已证实的普通 hook 误用，再测剩余 transition 耗时，不先引入 child 常驻池/预编译等新架构。

模型及批次间间隔在主样本合计仅4.909秒；它不是232秒的主要来源。endpoint 后空转是另一已知启动器收尾问题，与本次主体窗口分开结算。

## 7. 最小修复建议（本轮未实施）

1. 普通 `/check-permission`、`/stop-check` 不再先写 pending identity；继续发送原本的 session_id/agent_id 和真实输入、校验真实响应，保留原 allow/deny/fail-close/Stop 合同。
2. 真正的 MCP 工具调用仍保留 broker 的 identity acquire→consume 路径；不要全局删除 identity 机制，也不要改短服务端TTL掩盖误用。
3. 定向增加重复同名检查的真实时延回归，同时覆盖允许、拒绝和child身份，之后用同版本/同剧本重跑一个有界样本。
4. 给剩余 transition 时间加分段计时，再决定是否有第二个缺陷；现在不预报修复后应达到19秒。

## 8. 用户授权后的代码修复

- `permission-gate.ts`、`stop-gate.ts` 移除普通检查请求中的 `identity` payload；显式 actor IDs、输入、真实判定和错误语义不变。MCP broker 的 identity acquire→consume 路径未改。
- `gates.test.ts` 新增重复同名权限和Stop检查回归，覆盖main/child及允许/拒绝两种真实响应形状，并断言不写identity槽。已有Stop放行测试改用真实`{is_terminal:true}`响应，不再由错误shape触发的soft-pass冒充放行。
- 针对性17项测试通过：`node --test test/gates.test.ts test/gate-moves.test.ts test/broker-protocol.test.ts`。其中broker顺序测试仍确认MCP调用先注册source再acquire identity。
- 新增`test/gate-binary-latency.test.ts`，需显式配置`FSM_COMPATIBLE_TEST_SERVER`后运行；使用隔离真实daemon调用生产gate，每种身份连续3次Write权限检查、3次Stop检查，无provider调用或文件写入。首次运行：main权限740.7ms、Stop427.0ms，child权限472.0ms、Stop397.6ms（均为3次合计），回归通过；重跑日志存`ccv-latency-evidence/gate-fix-binary-test.log`。
- 插件`npm run check`通过。根`npm run check`的Biome阶段通过且未修改文件；随后被`.local/stability-against-oc/sources/pi-v1.2.0/`及`my-plugins/impression-demo/runs/sdk-snapshots/`中的既有非精确依赖版本阻塞，后续根检查未执行，未修改这些外部范围文件。
- 本轮未重新运行整个CCV剧本，因此不宣称232秒已经降到某个完整流程秒数；transition内部38.3秒的细分仍是未完成边界。

## 9. 修复后的完整v3场景重跑

- Run：`pi-v3-20261020-182523`；使用相同Pi启动器和当前v3剧本，没有修改剧本断言、延长门禁超时或连接旧daemon。新工作区、新FSM data-dir、新capture目录；没有真实模型费用。
- 主体口径：首个main-step `10:25:56Z`，最后一个 `10:27:26Z`，**33步、90秒**；首次`main-after-endpoint`为`10:27:27Z`。准备/启动等待及endpoint后的观察宽限不计入主体。
- 同为33步的修复前最新版样本`pi-v3-20261020-161635`主体292秒；本轮90秒，减少202秒（约69%）。最初232秒样本只有30步，不能冒充完全相同工作量的A/B。不同轮次的系统负载和gate缓存未做严格控制。
- `phase=endpoint`，main保持`V_A_LOOP`。`error`、`scenario-failed`、`scenario-crashed`均为0；首个endpoint前27条evidence记录，去重后22组编号/标签、覆盖13个B编号。总135条包含endpoint宽限期内重复检查，**不计作135个独立测试**。
- 真实迁移：main `V_INTAKE→V_A_INTENT→V_A_LOOP`；child `B_COLLECT→B_ANALYZE`，两次`B_DONE`格式负例hard-check失败，修正后`B_ANALYZE→B_DONE→_fsm_exit`成功。场景记录的B62在途裸写缺口仍是已知边界，不能由断言通过推导全面无漏洞。
- 主线程工具调用前/收尾等待：修复前最新版144.571秒，本轮6.563秒；等待child的工具execute从70.478秒降至13.846秒。两次主FSM转移execute仍合计57.149秒，剩余主要耗时应从该段继续定位，不再归因于child冷启动。
- harness按原watch逻辑在endpoint后停止本轮tmux；随后仅对本轮独立data-dir执行FSM stop，旧run和其它服务未清理。原workspace、数据库及capture保留。
- 启动/观察日志：`ccv-latency-evidence/rerun-after-fix.log`；分账、迁移、计数及原始路径：`rerun-after-fix-summary.json`。完整run日志仍在CCV原run目录。本轮没有覆盖15态走到V_DELIVER，结果仅对应完整v3场景。

## 附件

`ccv-latency-evidence/` 保存本轮分析脚本、逐批次/逐工具数据和隔离实验输出。原始完整session不复制，以免重复纳入系统提示或其它非必要数据。实验脚本包含本机路径，仅作为可追溯证据，不是生产测试入口。
