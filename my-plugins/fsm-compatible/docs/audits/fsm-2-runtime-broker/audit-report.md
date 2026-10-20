核查完成。以下为完整对照报告(绑定输出路径无写工具，按运行时约定在最终回复中交付全文，由 runtime 持久化)。

---

# fsm-2-runtime-broker 实施后独立 Contract 对照报告

状态：**PASS(0 critical / 0 unresolved)**;含 3 项记录级 P2。
对照材料:expectations.md(10 节)、subplans/fsm-2-runtime-broker.md、19 个实现源文件、9 个测试文件、修复记录 broker-fix-progress-unconfirmed-identity.md、测试报告 fsm-2-runtime-broker.md。全程只读，未读 implementation patch,未执行任何命令。

## 一、expectations §4 逐条对照(Step Pn 注释与源码一致)

**P1(manifest→初始化→startup tokens→资源 prepare→ready commit)** — 一致。
- `src/runtime/root-health.ts:47` `begin()` 处注释 `// Step P1: freeze this event's obligations; subsequent on/off changes only the future set.`,冻结快照即本轮义务集合。
- `src/runtime/managed-bootstrap.ts:13` 注释 `// Step P1: install begin before every callback registered by the managed factories.`,bootstrap begin 先于全部 factory 注册。
- ready 判定链：全部 factory `markInitialized(id,true)` + 本 epoch 全部 expected token `observe` 成功 + `markPrepared`(`root-health.ts:70-79` `commit()`),且 `state.committed` 保证单次 commit。

**P2(实际 HostIdentity→共享 scope/key→atomic mkdir/token)** — 一致。
- `src/coordination/canonical-lease.ts:26` 注释 `// Step P2: a physical-host key, never an independent per-root mutex.`,key 为 `${pid}-${startId}-sha256(tool)`(`canonical-lease.ts:41`),mkdir 为唯一独占点。
- Linux:`host-identity.ts:29-33` 按 comm 括号切分后取 `fields[19]`(/proc stat 第 22 字段 starttime,正确)；macOS:`host-identity-macos.c:14-23` `getppid` + `proc_pidinfo(PROC_PIDTBSDINFO)` 的 `pbi_start_tvsec*1e6+tvusec`,微秒合成、`PRIu64` 十进制输出，无 ps/Date.now 替代；解析端 `parseHostIdentity` 强制 `pid===process.pid`、startId 为正 64 位十进制串(`host-identity.ts:14-20`),即 helper 直接父 PID 必须等于 Pi pid。

**P3(权威 source/identity 响应→MCP→lease release)** — 一致。
- `src/broker/fsm-broker.ts` `invokeAdmitted` 首行注释 `// Step P3: acquire and invocation share one physical-host/canonical lease.`;实际顺序：取得 lease → 复查 usable → `registerAndConfirmSource` → POST `/identity/acquire`(body 恰为 session_id/agent_id/tool_name/agent_cli:"opencode"/opencode_server_url)→ `requireDaemonOk` → `sent=true` → MCP tools/call。
- `src/broker/fsm-tools.ts:26` 注释 `// Step P3: published tools can only call the broker with their actual session binding.`,execute 强制 binding.sessionId === ctx 实际 SID。

**P4(失败/取消/未知→close 确认/保留锁→owner 清理)** — 一致。
- `src/runtime/runtime-resources.ts:22` 注释 `// Step P4: revoke admission before closing resources in reverse acquisition order.`,close 先 `active=false` + abort 再逆序 dispose;失败聚 AggregateError 不跳过后续(`runtime-resources.test.ts` 断言 order=[3,2,1])。

## 二、§5 行为逐条核对(全部有源码+测试证据)

- **register null 仅尝试 + source 读回核六字段**:`register-source.ts:21` 要求 2xx 且 `body === null`,否则 protocol-invalid;随后 GET 读回逐一核验 `session_id/agent_pid/kind/cwd/opencode_server_url/transcript_path===null`,任一不符或非 200 → not-ready。测试 "D2-1: register null alone does not authorize calls" 覆盖 404 与六字段逐一篡改，且失败时 daemon.seen 停在 2 个请求(无 identity/MCP)。
- **快照注销三态**:`root-health.test.ts` 三个 D2-2 反例：启动前 off(真实注销+义务消失)、本轮 off(已进快照仍执行 1 次且 ready)、本轮 on(本轮 calls=0,下轮 calls=1)。实现侧 `deactivate` 同步删未来 token 并调真实 unsubscribe,幂等(`managed-bootstrap.ts:43-47`)。
- **atomic mkdir 唯一独占 + token 释放**:`canonical-lease.ts:51-56` mkdir→`owner.json` 以 `flag:"wx", mode:0o600` 写入；写失败仅 `rmdir` 本次刚取得目录。测试跨 root 串行(second 在 first.release 前不 entered)、不同 tool/不同 startId 不共锁、cancel/deadline 不偷锁、foreign token release → protocol-invalid 且锁内容不变。
- **unknown 确认 Client 终结才放锁(控制 POST 与 MCP 分流)**：
  - 控制写 unknown(register/identity 经 `requestMutation`,任何异常归 delivery-unknown,不重发)：broker 在未 sent 时关闭 transport、`usable=false` 拒绝复用、**保留 lease**。测试 "unknown register writes retain isolation"(seen 仅 ["/session/register"],scope 剩 1 目录)与 broker-protocol "uncertain identity write cannot release its lease for a late server write"(第二次 invoke → not-ready)。
  - MCP 已 sent unknown:释放条件 = `transport.close` 返回 true(确认本 Client 终结)。测试 "MCP unknown after send waits for confirmed process closure before releasing isolation" 在包装的 close 内断言 close 期间 lease 仍在(observedHeld=true)、确认后 scope=[]。
  - 尚未发送的 cancelled/deadline:非 delivery-unknown,finally 安全放锁(broker-cancellation 测试 1:close 取消未开始 caller,daemon.seen=[] 无 mutation)。
- **MCP 分页/错 ID/progress**:`fsm-catalog.ts` 全分页循环+cursor 环检测+重名/空集拒绝+Ajv/Ajv2020 编译失败拒绝;`mcp-transport` 仅接受匹配 requestId 的响应(未知 id 即 fail)、queue-full 在写入前拒绝、progressToken=requestId 只路由关联 pending、cancel/超时/子退出 → delivery-unknown 且 transport 失效。测试对应覆盖(progress 仅达关联调用，长度 1)。
- **真实父 PID start identity**:测试 "actual supported host identity is stable..." 直接运行真实 helper,断言 `first.pid===process.pid` 与两次探测 deepEqual;Linux 字段解析含 comm 空格/括号与 pid 不符拒绝。
- **注册冲突显式 not-ready,不删 nativeMCP**:`fsm-tools.ts:17-19` 对 raw 名/`mcp__fsm__name`/其它命名空间后缀三种冲突均 throws not-ready 且零注册(测试断言 definitions.size===0)。

## 三、§6/§7/§9 性质核对

- **旧 epoch 不投新 root**:`RootHealth.match` 以 epoch 对象同一性匹配，旧 epoch 的 observe/markPrepared 对 current 无效(测试 "old epoch acknowledgments and incomplete resources cannot commit")。**ready 单次 commit**:重复 commit 返回 false(两处测试断言)。
- **缺 startup/失败/旧 token 不错 ready**:init 抛错与 startup 抛错两种模式跨 `startup("new-root")` 仍 false;`markInitialized` 对已 false 的 factory 拒绝翻转为 true(`root-health.ts:36-37`),满足“初始化失败不被新 session_start 重置”。重复 token 不重复提交(Set 幂等 + expected 门控)。
- **跨 root 同 host 串行、不同 tool 并行**：lease 测试 + broker 测试(两 root 并发 invoke,maximum===1);不同 tool/不同代际路径不同。
- **§8 有界性**：queue 上限(默认 64)、等待仅到 deadline、`waitForLease`/call timer/close timer 均 unref 并清理；无无限清理挂钩。
- **§9 安全**：helper 每请求新进程读新 token(测试用 secret-one/secret-two 验证 header 不缓存)；helper stdout 仅回 JSON reply,错误路径静默 exitCode 1,无 token 泄漏;`owner.json` 无秘密；scope 0700+lstat 拒绝符号链接/异 uid/(mode&0o077)≠0;测试 scope 显式定向 `test/.tmp`;src 无 `globalThis` 注册表;`package.json` scripts 无 pre/post-install(cc 构建为显式步骤，`.c` 源与 `.runtime/bin` 产物均在插件内)。

## 四、与一手源的合同一致性(api.rs/auth.rs 侧，按报告与字段合同核对)

register 成功 body 为 JSON null、`/session/source?session=` 读回、`/identity/acquire` 五字段、wire_contract_version=2 + skill_schema_version=2 + features 双门槛(`daemon-capabilities.ts:24-27` 强制 `dispatch_state_admission_v1`+`typed_input_exact_v1`,版本/feature 变体五种均 not-ready 有测试)、x-fsm-auth 每请求读 token——与报告所述 0.11.0/wire2 隔离通道 1/1 相符。本轮未调用 provider/daemon,未运行 fsm-binary-protocol.test.ts(需环境变量，按任务边界不要求)。

## 五、Findings

**P2-1(记录级)** `src/coordination/canonical-lease.ts:44-49`:独占前校验只对 `coord` 叶目录做 lstat(符号链接/uid/0700);父目录 `pi-fsm-compatible-<uid>` 本身未独立复查。异 uid 预建 base 的情形会被叶目录 uid/mode 检查拒绝，残余风险仅限“同 uid 攻击者预置符号链接 base”这一非威胁场景。最小修复(可选)：对 base 追加一次同样的 lstat 检查。

**P2-2(记录级)** `src/process/read-json-process.ts:45-48`:finally 中 `owned.close` 超时(10s 内未退出)会抛 transport-failed,可能覆盖体内已抛出的原错误(如 cancelled)。SIGKILL 后实际不可达，仅为错误保真度备注。

**P2-3(记录级，非违规)** `src/broker/daemon-request.mjs:17`:固定 allowlist 含 `/check-permission`、`/stop-check`,超出 expectations §4.1 枚举；经查有真实调用方(`gates/permission-gate.ts:18`、`gates/stop-gate.ts:28`,既有单元共用同一 helper),属固定白名单扩容而非任意 route 放行。

**边界观察(非 finding)**:`openOwnedRuntime`/`closeOwnedRuntime` 与 `markPrepared` 的根入口接线在 src 中尚无调用方——与叶子合同自述“完整根入口/SA/protocol/child/gates/Watcher 接线待完成”及 expectations §10 退出边界一致；本单元交付的是组件库，生产 ready 在 core prepare 接线前不可达，测试以 fake core 直接驱动。不构成对照差异。

**测试覆盖与无削弱**：37 项 runtime + 22 项旧单元回归 + 1 项真实二进制隔离(本轮未运行)的报告与测试文件实际断言吻合；修复记录所述两处失败例(progress 丢失、unknown identity 提前释放)均保留为反例并转化为上述顺序断言，未见删除或弱化。

## 六、结论

实现与事前 expectations/叶子合同逐条一致；P1-P4 步骤注释与实际控制流吻合；修复记录描述的根因与修复在源码中可复核。0 critical / 0 unresolved,判定 **PASS**。剩余责任边界(protocol/judge/child/gates/Watcher/安装/根入口接线、根 npm check 未跑、Biome 缺依赖披露)按 §10 保持开放，不属于本单元结算范围。