# fsm-2-runtime-broker 实施前设计审查

## 结论

**本单元：BLOCKED。**

B3/B4 的主要机制已经具体化，架构路线可以保留；仍有两处本单元合同缺口需要局部修正：

1. `/session/register` 的成功响应不能证明 source 实际登记成功。
2. startup token 账本未规定注销及当前事件快照语义，可能等待实际上不会执行的 handler。

不重审首单元 PASS，不重开 B1/B2/C1 或 B5–B9；不以尚未实现、缺真实模型运行阻塞设计。

## 六项标准

| 标准 | 判断及依据 |
|---|---|
| **1. 目标组合、协作论证、假设** | **基本就位，两个假设未闭合。** `docs/design/fsm-compatibility/subplans/fsm-2-runtime-broker.md:7-10` 明确 R1–R4；`:104` 给出健康与身份调用的事实链。登记响应和 handler 集合的实际语义存在下述差异。 |
| **2. 细化结构** | **通过。** 叶子合同 §1–§7 覆盖目标、机制、数据、流程、资源、论证、文件及验证；`docs/design/fsm-compatibility/detailed-design.md:121-147` 已同步 owner/helper/broker 函数合同。 |
| **3. 推导、分支、出口、callee、循环、假设** | **未全通过。** 租约取得、失败、取消、未知响应及截止出口已经明确，见叶子合同 `:68-76、90-102`；source 登记的失败事实和 startup 注销/快照分支未被承接，见 D2-1/D2-2。 |
| **4. 非平凡函数 pre→post 论证** | **部分通过。** 原子取得、代际身份、完整持锁区间及资源提交点均有论证，见 `:76、100-106`；登记确认与 startup 完整性证明仍缺必要事实。 |
| **5. 与父模块合同一致** | **未全通过。** 父合同要求真实建立服务路由并在登记源/身份后调用，见 `architecture.md:126、142-144`；现有两处细化不足以推出这些保证。 |
| **6. 明确到可编码** | **未通过。** 实施者仍需自行决定 source 登记的确认步骤及 token 注销/快照规则。两处补齐即可，无需改架构。 |

## 已正确的设计

### B3：真实加载与健康提交机制基本闭合

`subplans/fsm-2-runtime-broker.md:16-38` 已明确：

- 顶层静态 import 与 canonical manifest 对应，执行实际 factories。
- 初始化失败、本 session startup 失败不能成为 ready。
- 使用 actual session ID、owner epoch 和 token，不借私有 loaded 查询。
- core 只 prepare，不等待后续串行 handler；健康与完整资源准备共同决定 commit。
- protocol/gate/child 缺失时不能用 noop 标 prepared。

这与 Pi 串行 await handler 的实际行为一致：`PI/dist/core/extensions/runner.js:813-839`。没有新增模型宿主或 GUI 要求。

SA owner 注册选择也正确：叶子合同 `:44` 使用事件接口；实际 `SA/src/agents/runtime-agent-events.ts:28-76` 由 listener 使用自身 `pi` 注册并写回结果，避免消费者 API 与 SA WeakMap owner 不一致。

### B4：原占位机制已具体化

叶子合同 `:50-76` 已选择实际 PID/startId、共同 scope、atomic mkdir、随机 token 和明确释放条件，而非 per-root mutex。

身份表达与一手源一致：

- `FSM/crates/server/src/process.rs:80-94`：Linux `rest[19]` 为 start ticks。
- `:104-136`：macOS 使用 `PROC_PIDTBSDINFO`，以 timeval 合成微秒身份。

同键独占、未知调用先确认 Client 终结、无法确认则保留锁、不按 mtime 抢锁、新代使用不同 key，均已明确。OS 临时目录是运行时协调资源；源码、测试和构建仍限制在插件目录，不构成修改外部源码。

## D2-1 — P1：source 登记缺少实际确认步骤

**设计位置：**

- 叶子合同 `:82-86`：依据实际 HTTP status/body 判断 route 成功。
- `:92`：流程直接从“确认 source register”进入 identity acquire。
- `detailed-design.md:133、137`：同样将响应校验作为登记确认事实。

**一手源反证：**

`FSM/crates/server/src/api.rs:2145-2161` 的 `/session/register`：

- 调用 `register_agent_session`；
- **忽略其返回值**；
- 始终返回 `Json(())`，即成功的 JSON null。

`FSM/crates/server/src/session.rs:1416-1445` 明确该登记是 best-effort：peer 无法解析等情况不存入记录，返回 false，而 HTTP handler 不将其转为错误。

因此，直接 spawn helper 和读取真实响应解决了 peer 拓扑及 exit0 问题，**但该 route 的成功响应本身仍不是“source 已存入”的证明**。`/evidence/source-auth` 也仅更新认证信息，不承担 source 登记确认，见 `api.rs:2332-2342`。

**最小必要修正：**

在登记之后，通过现有 `GET /session/source?session=<rootSessionId>` 读回并核对：

- session ID；
- `agent_pid` 与实际宿主 PID；
- `kind=opencode`；
- 当前 owner 的 cwd/server URL。

该现有接口及返回字段见 `api.rs:2271-2330`。将读回加入 helper 固定 route 合同；不存在、字段不符或超时均不能提交 ready/发出本次 MCP。

同时明确 `/session/register` 的合法响应是 null，含义仅为登记尝试完成；不修改 FSM 路由或协议，不以自动重放未知 mutation 替代确认。

**违反原合同：**`architecture.md:126、142-144`，本单元 R2；六项标准中的 3、4、5、6。

## D2-2 — P1：startup token 未承接注销及事件快照语义

**设计位置：**

叶子合同 `:26-30` 规定 on 注册即加入预期 token、wrapper 完成后记录成功；`:34-36` 的账本未说明注销及当前 epoch 预期集合的变化规则。

**实际 callee 合同：**

- `PI/dist/core/extensions/types.d.ts:1152`：`on("session_start", handler)` 返回注销函数。
- `PI/dist/core/extensions/loader.js:213-228`：注销会实际移除 handler。
- `PI/dist/core/extensions/runner.js:87-88、816-819`：每次事件先复制 handler 列表，再依次 await。

**具体缺口：**

合法 factory 可以先注册 startup handler，再在初始化结束前注销它。当前描述会留下预期 token，但实际 Pi 不会执行该 wrapper；即使所有实际必需 callbacks 成功、资源准备完成，也可能永远无法 commit。

另一方向，在正在执行的 startup 中新注册 handler，不会加入 Pi 已复制的当前事件列表；若账本立即把它加入当前 expected，也会等待本轮不存在的回执。

**最小必要修正：**

明确代理维护两层状态：

1. 活跃注册集合：on 加入，返回的包装注销函数同步移除未来预期 token，并调用真实注销。
2. 当前 epoch 预期快照：begin 时冻结，与本次实际 startup 列表一致；本轮注销不抹除已进入事件快照的义务，本轮新增 handler 留给下次启动。

保留现有 session/epoch 匹配、失败记录及单次 commit。测试计划加入“启动前注销”和“本轮新增留待下轮”反例；不要求设计阶段实际运行它们。

**违反原合同：**runtime-owner 的实际初始化/启动与可用性保证、本单元 R1，以及原 Pi API 转发语义；六项标准中的 3、4、5、6。

## 放行边界

- **Correct：**静态 manifest 组合、prepare/commit 分离、SA owner 事件注册、实际 HostIdentity、原子目录租约及未知调用释放顺序均可保留。
- **Fixed：**无；本次只读。
- **Finding：**D2-1、D2-2，均为本单元原合同的具体细化缺口。
- **Merge verdict：BLOCK；本单元 BLOCKED。**

修正仅需补登记读回和 token 生命周期规则；无需增加 OS sandbox、任意未来 provider、GUI 或 optional 工具要求。完整 protocol/gate/child 尚未实现不是本次阻塞项，但不得冒充 prepared。

本次未执行命令、修改文件、调用 provider/daemon 或启动子代理；未验证 helper 构建，也未宣称全仓检查通过。