# fsm-compatible

官方 Pi 的 FSM Server（use-fsm）兼容插件。FSM daemon 保留状态、权限、调度和 Evidence 的裁决；插件负责身份绑定、OC HTTP 协议、工具映射和门禁。目标与历史设计见 [docs/principles.md](docs/principles.md)。

## 当前运行依据（2026-10-28 收口）

- HC 四原生工具与通信/FSM 行为的一比一替换（设计见 [docs/design/subagent/](docs/design/subagent/)，源证见 [docs/research/hc-subagent-contract-20261023.md](docs/research/hc-subagent-contract-20261023.md)）。
- 对偶测试：**14/14 剧本 PASS**（v2×3 + v3×3 + v4×4 + fuzz×4，`my-plugins/hc-fsm-reference`），运行方式与覆盖边界见 [docs/design/subagent/test-contract.md](docs/design/subagent/test-contract.md)；合法差异面以 [docs/design/subagent/dual-legitimate-differences.md](docs/design/subagent/dual-legitimate-differences.md) 为唯一合同（D1–D9 + 3b 节收口机制）。
- 工具契约：模型可见工具面与 HC 逐对象相等（26 工具：名单/参数/约束/描述/wire 键），由对偶 runner 的 `PLOT_TOOL_DEFS_STRICT`（默认开启）每请求强制校验。
- 单测：`npm run test` 170/170；`npm run check` 0。
- 普通 permission/Stop 检查直接使用 actor IDs，不写 MCP identity 槽；真正 MCP 调用保留 identity acquire→consume。

### HC 版本漂移：re-collect 流程

golden 是真 HC collect 的快照。HC 二进制或协议升级后：

```sh
# 1. 重新 collect（拒绝覆盖已有 golden，先挪走旧目录）
python3 my-plugins/hc-fsm-reference/bin/use-plot <plot> --collect   # v2（fuzz 复用）
python3 my-plugins/hc-fsm-reference/v3/bin/use-plot <plot> --collect
python3 my-plugins/hc-fsm-reference/v4/src/run_experiment.py my-plugins/hc-fsm-reference/v4/plots/<plot>.json --collect
# 2. fresh replay 一轮确认双轮匹配（verify 脚本 exit 0）
# 3. Pi 对偶全量复验（runner 自动用新 golden）：
node my-plugins/fsm-compatible/scripts/dual/run-plot.mjs --plot=<plot.json>
```

任何 mismatch 先对照 dual-legitimate-differences.md 归类；未命中即 Pi 实现缺口（默认修实现，禁止改 golden 迁就）。

## 项目级加载（不全局安装）

在本插件目录执行：

```sh
npm ci --ignore-scripts
npm run build:nico
npm run build:identity
cp fsm-compatible.config.example.json fsm-compatible.config.json
```

`build:nico` 将 `vendor/pi-subagents` 的 `createDefaultChildSessionFactory` 编译到 `.build/nico/`（桥接产物随源码保存；vendor 子模块本身不修改）。缺失时插件无法创建子会话。

编辑本机配置：

- `dataDir`：正在运行的 FSM daemon 数据目录。
- `clientCommand` / `clientArgs`：与该 daemon 配套的 MCP client。
- `cwd`：可省略，默认使用 Pi 启动目录；必须是实际工作区，hard gates 会在对应身份的 cwd 执行。
- `capacity` / `timeoutMs`：并发容量和普通请求超时；FSM 工具调用目前使用 `timeoutMs × 10` 的预算。
- `modelSource: {}`：配置文件保留此对象，实际 judge 模型及 provider 由宿主会话的 model registry 接线，不在 JSON 中填写函数或密钥。
- `allowedAgentNames`：固定宿主 agent 类型，默认 `["general"]`；它不是 dispatch 指定的 FSM skill 名。HC 原生 catalog 含 `general`（全工具）与 `explore`（只读 ceiling）。
- `subagentDepth`：HC `subagent_depth`，四工具可见性与创建深度上限，默认 3；与 FSM admission 的 `maxDepth` 相互独立。
- `maxDepth`：默认8；`requiredExtensions`：额外必载的 `{id,path}` 列表，使用绝对文件路径。FSM 插件自身始终必载。已持久化会话的策略只能收窄，不能通过改配置扩大名单或删必载项。

macOS 身份 helper 构建需要 `/usr/bin/cc`；Linux 使用 `/proc`。当前不支持其它平台。需要提供 `wire_contract_version >= 2` 的真实 FSM daemon，不能只根据二进制文件名判断版本。

在目标项目目录临时加载插件：

```sh
pi -e /absolute/path/to/fsm-compatible/src/index.ts
```

或者使用 `pi install /absolute/path/to/fsm-compatible/src/index.ts -l` 保存项目级加载配置。不要注册到 `~/.pi/agent/`，也不要用 symlink 将入口孤立放进 `.pi/extensions/`。缺配置或初始化失败时插件会阻止继续执行，而非无门禁降级。

原生持久子会话要求官方 Pi 1.3.0 的 RPC/`agent_settled` 行为；目前实际测试版本是1.3.0。包内 SDK/类型依赖仍历史锁定1.0.3，不能从该依赖版本推断旧宿主也支持新路径。

运行环境可覆盖 `FSM_COMPATIBLE_CONFIG`（配置文件绝对路径）、`FSM_DATA_DIR`、`FSM_COMPATIBLE_CLIENT`。`CCV_HOME` 按具体工作流的原启动方式在运行时提供，不修改全局 shell 配置。

## 工具与子代理（HC 原生四工具）

- 模型侧只有 `agent` / `agent_list` / `agent_send` / `agent_stop`，schema、描述、回执文本与域错误与 HC 基线一比一；没有 `Agent`/`task`/`subagent` 别名，没有 `agent_status`，不返回 JSON 回执。域错误是普通文本结果（`metadata={}`），不是 `isError`。
- 子会话是同进程 Nico `ChildSession`（`vendor/pi-subagents` 内部 factory，`ambientExtensions:false`、无扩展 bundle、`codemode` 始终排除）；FSM 工具、权限门、Stop 门和（深度内）四工具通过 inline hook 进入子会话，同进程直接调用，无 child HTTP proxy、无 tmux、无文件 inbox。
- 协议 SID（`ses_...`）与 SDK session id 显式分离；父链、名字、模型/variant、notify、workdir、目录先于首次后台运行持久化到根 transcript。任意 SID 寻址域是本 runtime 的会话树（含根）；不同 root 树的 SID 不可达（等同 HC 实例边界）。
- `agent` 创建：深度/名字/类型检查→HC workdir 语义（省略 cwd 时在 `.opencode/worktrees` 准备 git worktree/空目录，`enforced:false`；显式 cwd 仅 resolve）→目录登记→actor acquire→目录指令+父/运行中兄弟快照+原始 prompt 首轮。每轮结束按 HC 分类向父投递 `agent_result`/`agent_error` 信封（cancelled 只 settle）；待消费输入或存活后代时延后重查。
- `agent_send`：短名邻域解析，SID 直通；self 拒绝；busy 用 `steer`、idle/已停用 `prompt` 续行；Accepted 只承诺调度。
- `agent_stop`：仅直属 child，后代按深度降序级联 cancel；不 dispose、不删会话；完成后向 caller 投递一条来自 target 的取消消息。
- 正常 Stop 仍走既有 Stop gate（idle 后判决，拒绝时续投 continuation）；显式 stop 是直接取消，不经审批。每轮父报告与 Stop 判决是独立链路，无 StopAllow 屏障。
- FSM：`agent→Agent` 名称映射与原参数上报不变；created 先于子首次 FSM 调用 acquire actor `(rootSID, childSID)`；失效 MCP channel 缓存已修（初始化 rejection 与已建 broker unusable 分别处理，仅当前条目仍指向失败实例时移除）。

## 检查

```sh
npm run build:nico
npm run check
npm run test:admission
npm run test:runtime
npm run test:protocol
npm run test:judge
npm run test:gates
npm run test:children
npm run test:watch
npm run test:assembly
npm run test:commands
```

`npm run test:fleet` 中 `test/fleet-ui.test.ts` 仍断言旧 tmux 提示串（已退出生产行为），当前真实失败；其余 fleet 文件通过。旧 runner 相关套件（`test:native`/`test:parity`/`test:ccv`/`test:binary`）针对已退役但保留的 legacy 模块，需真实二进制，未在本轮重跑。

真实 daemon 的重复权限/Stop 时延回归（全新隔离数据目录，无真实模型调用）：

```sh
FSM_COMPATIBLE_TEST_SERVER=/absolute/path/to/mcp-server-fsm \
  node --test test/gate-binary-latency.test.ts
```

真实子会话回归需要显式指定二进制，不允许悄悄 skip：

```sh
export FSM_COMPATIBLE_TEST_SERVER=/absolute/path/to/mcp-server-fsm
export FSM_COMPATIBLE_TEST_CLIENT=/absolute/path/to/mcp-server-fsm-client
export FSM_COMPATIBLE_TEST_PI=/absolute/path/to/pi/dist/cli.js
export FSM_COMPATIBLE_TEST_MOCK=/absolute/path/to/mock-llm-server
npm run test:native
```

`npm run test:parity` 另外需要 `FSM_COMPATIBLE_TEST_OC`、`FSM_COMPATIBLE_TEST_OC_PLUGIN`、`FSM_COMPATIBLE_TEST_HOOK`、`FSM_COMPATIBLE_TEST_OC_MODELS`。最后一项是固定 OC model catalog，避免网络发现。

`npm run test:ccv` 另外需要 `FSM_COMPATIBLE_TEST_CCV_ROOT`（干净可 clone 的 CCV 源码）、`FSM_COMPATIBLE_TEST_CCV_MOCKER`（原版 v3 `.py/.c/.md` 剧本目录）、`FSM_COMPATIBLE_TEST_RUNTIME_ENV`（已安装真实工具链的 `prep/env.sh`）。runner 创建私有 framework clone、HOME、workspace、FSM data dir，不修改输入仓库或全局配置。v3 保持原 endpoint；另一个用例测试诚实失败交付。

runner 在 `.runtime/` 保存源码/二进制 hash、版本和结果。raw captures、bootstrap、环境文件可能含凭据，**不可直接提交**；只发布选取并脱敏的报告。mock 的 judge/watcher verdict 仅服务协议集成，真实 hard gates 不跳过。

历史 wire2 通道测试另见 `npm run test:binary`；它包含固定 wire2 断言，不应拿 wire7 运行结果冒充该用例通过。

## 已知边界

- HC `resolvePromptParts` 会把 prompt 中的 @file 展开为附件 parts；宿主 `ChildSession.prompt(text: string)` 是窄接口，无法表达附件 parts。本轮初始 prompt 原文透传（不丢弃、不裁剪），@file 引用不展开为附件——这是真实 SDK 缺口，已向主线程报告，不积平。
- 每轮报告的 error/length 逃逸字段从 Pi 投影适配：Pi 只有单一 `errorMessage` 字符串与 `usage`，无 HC 的 `error.name/data.message` 分离；`reasoning_tokens` 缺省时记 0。usage 缺失时不虚构。
- `/subagent send ... -- pi flags` 的 extraArgs 为兼容保留解析，但同进程子会话无 CLI 旗标，不再向子进程传递（旧能力随子进程运行器一并退出）。
- 任意 SID 投递域是本 runtime 的树；跨 root 树的 SID 不可达（HC 实例边界语义）。`/session/source` 定位跨 runtime 消息的现有 HTTP 接口只达根会话 advisory，不能向其它树的 child 定向投递。
- Fleet widget 为只读投影：显示真实 model/状态/outcome 与 transcript 路径（`/subagent transcript <id>`）；没有子会话控制面。
- 历史运行的两次主 FSM 转移约57秒，尚未按 hard-check/evidence/review/commit 细分；新版总耗时不能冒充该内部成本的精确解释。
- CCV v3 的 B62 明确记录在途目标的裸写缺口；场景断言通过不等于这个缺口已修复。
- mock 的 soft judge 返回剧本判定，不能替代真实模型评审正确性或完整15态验收。
- 构建产物、分析缓存与本机配置不提交；可复现的源码、锁文件和运行证据随插件保存。
