# fsm-compatible

官方 Pi 的 FSM Server（use-fsm）兼容插件。FSM daemon 保留状态、权限、调度和 Evidence 的裁决；插件负责身份绑定、OC HTTP 协议、工具映射和门禁。目标与历史设计见 [docs/principles.md](docs/principles.md)。

## 当前运行依据

- 单元覆盖准入/绑定、daemon/MCP 通道、记录/judge、child 门禁、Watcher 和命令翻译。
- 官方 Pi 1.3.0 + 真实 FSM wire7 + mock LLM 的完整 **CCV v3 场景**已到 endpoint：33 步主体从修复前292秒降到90秒，0断言失败/脚本崩溃。
- 该场景的 main 停在 `V_A_LOOP`，不表示15态全部走到 `V_DELIVER`；子 FSM 的格式负例拒绝、修正后收口和退出均有运行记录。
- 普通 permission/Stop 检查直接使用 actor IDs，不写 MCP identity 槽；真正 MCP 调用保留 identity acquire→consume。
- 详细运行数据及未完成项见 [延迟调研与修复报告](docs/test-reports/ccv-latency-investigation.md)。历史单元审查材料位于 `docs/audits/`，不代替当前整机覆盖证明。

## 项目级加载（不全局安装）

在本插件目录执行：

```sh
npm ci --ignore-scripts
npm run build:identity
cp fsm-compatible.config.example.json fsm-compatible.config.json
```

编辑本机配置：

- `dataDir`：正在运行的 FSM daemon 数据目录。
- `clientCommand` / `clientArgs`：与该 daemon 配套的 MCP client。
- `cwd`：可省略，默认使用 Pi 启动目录；必须是实际工作区，hard gates 会在对应身份的 cwd 执行。
- `capacity` / `timeoutMs`：并发容量和普通请求超时；FSM 工具调用目前使用 `timeoutMs × 10` 的预算。
- `modelSource: {}`：配置文件保留此对象，实际 judge 模型及 provider 由宿主会话的 model registry 接线，不在 JSON 中填写函数或密钥。

macOS 身份 helper 构建需要 `/usr/bin/cc`；Linux 使用 `/proc`。当前不支持其它平台。需要提供 `wire_contract_version >= 2` 的真实 FSM daemon，不能只根据二进制文件名判断版本。

在目标项目目录临时加载插件：

```sh
pi -e /absolute/path/to/fsm-compatible/src/index.ts
```

或者使用 `pi install /absolute/path/to/fsm-compatible/src/index.ts -l` 保存项目级加载配置。不要注册到 `~/.pi/agent/`，也不要用 symlink 将入口孤立放进 `.pi/extensions/`。缺配置或初始化失败时插件会阻止继续执行，而非无门禁降级。

运行环境可覆盖 `FSM_DATA_DIR`、`FSM_COMPATIBLE_CLIENT`。`CCV_HOME` 按具体工作流的原启动方式在运行时提供，不修改全局 shell 配置。

## 工具与子代理

- Pi/OC 输入映射到 FSM 的 CC 名称和字段，例如 `write(path)` → `Write(file_path)`、`edit` → `Edit`/`MultiEdit`、`find` → `Glob`。
- 官方 Pi 1.3.0 没有 GPT 专用的 `apply_patch` 自动切换。当前没有该工具的执行/多文件权限映射，不宣称支持外部 patch 扩展。
- 原生 `Agent` 工具提供 `agent`、`task`、`subagent` 别名，接收 `{description, prompt, subagent_type}`；它异步启动子 Pi，立即返回 child ID，日志写入工作区 `.fsm-agent-logs/`。
- child 用 `-ne` 禁止自动发现无关扩展，转发父 CLI 的 `-e` 扩展；FSM actor 使用 `(root_session_id, child_agent_id)`，不依赖 `third-party-plugins/pi-subagents`。
- `AskUserQuestion` 在 UI 可用时注册，因此建议保持上述项目级或临时加载方式。

## 检查

```sh
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

真实 daemon 的重复权限/Stop 时延回归（全新隔离数据目录，无真实模型调用）：

```sh
FSM_COMPATIBLE_TEST_SERVER=/absolute/path/to/mcp-server-fsm \
  node --test test/gate-binary-latency.test.ts
```

历史 wire2 通道测试另见 `npm run test:binary`；它包含固定 wire2 断言，不应拿 wire7 运行结果冒充该用例通过。

## 已知边界

- 两次主 FSM 转移在最新运行中仍耗时约57秒，尚未按 hard-check/evidence/review/commit 细分。
- CCV v3 的 B62 明确记录在途目标的裸写缺口；场景断言通过不等于这个缺口已修复。
- mock 的 soft judge 返回剧本判定，不能替代真实模型评审正确性或完整15态验收。
- 构建产物、分析缓存与本机配置不提交；可复现的源码、锁文件和运行证据随插件保存。
