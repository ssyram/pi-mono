# fsm-compatible TUI 剧本设计与实跑简报

## 结论

已在 `my-plugins/hc-fsm-reference/v5tui/` 实现三份独立 tmux runner、公共驱动、独立断言脚本和覆盖文档。三份最终剧本均使用真实 Pi TUI、`zai-999-g-l/glm-5.3`、`-ne` 与两个显式 `-e` 扩展，Pi exit code 均为 0；自动断言共 29 条，全部通过。

## 剧本

| 剧本 | 意图 | 断言数 | 真跑结果 |
|---|---|---:|---|
| `run/question-dialogs.mjs` | 在 `BuiltinWork` 中用 Down+Enter 选 `Beta`、输入 `tui-typed-evidence`、Escape 取消；断言三种工具结果、三组 `ask-start/ask-end`、`Work → Done → _fsm_exit` | 12 | exit 0；`evidence/20261029033444-question-dialogs/` |
| `run/fleet-state-sequence.mjs` | 启动 `tui-fleet`，pane 依次断言 `BuiltinWork:Work`、`BuiltinWork:Done`、exit 后 `_default:S_default` 与 completed summary；两次 `agent_send` 均有接受回执和 agent message | 10 | exit 0；`evidence/20261029034106-fleet-state-sequence/` |
| `run/agent-lifecycle.mjs` | 启动阻塞中的 `tui-stop`，断言运行 Fleet 行；调用 `agent_stop` 后断言停止结果、取消通知和 `0 run / 1 done` | 7 | exit 0；`evidence/20261029033420-agent-lifecycle/` |

每个 evidence 目录包含 pane dumps、root transcript、daemon request log、FSM history/log/identities、owned daemon 数据、`result.json` 和 `assertions.json`。

## 驱动稳定性

- 按 `.pi/skills/interactive-testing.md` 使用 tmux 创建固定尺寸终端、`send-keys` 驱动和 `capture-pane` 断言。
- 当前 pane 用于 dialog/widget 的实时断言；scrollback 用于短暂 notify；session JSONL 按消息角色等待 assistant/agent 回报，避免把用户 prompt 当结果。
- owned FSM daemon 使用仓库内短 socket 路径，结束后移动到 run evidence；所有 readiness、模型完成、pane 状态和进程退出均为轮询 deadline，没有裸 sleep 成功判定。
- `FSM_DUAL_DAEMON_LOG` 保存 `/gate/suppress` 与 `/gate/release` 请求，使 `ask-end` 可直接审计。

## 发现并修复的问题

真实 Escape 暴露了 `ask-tool.ts` 缺陷：Pi dialog 取消返回 `undefined`，旧代码把它转成空字符串成功结果。经报批后实施最小修复：`undefined` 返回 `question cancelled: user cancelled` 且 `isError: true`，并保持 `finally` 的 `ask-end` release。`test/watch.test.ts` 新增 `undefined` 取消回归断言，`npm --prefix my-plugins/fsm-compatible run test:watch` 为 7/7 通过。

## HC 对照边界

HC/OpenCode `Question` 后端存在 `ask/reply/reject` 生命周期，通用 TUI control 也有 request/response 队列；但 `../haokun-code/packages/opencode/src/` 没有可供该 tmux runner 驱动的 question dialog 按键自动对照入口。因此方向键、Enter、Escape 和 Pi dialog 渲染明确标为 Pi 自有 TUI 面，只对照 HC reply/reject 语义，不声称 OC TUI 键位 parity。

## 残留

- 真模型/provider 波动可能导致 deadline 失败；runner 会保留完整 evidence 并非静默重试。
- 用户级无效 theme 的启动警告仍出现在 pane，但不影响断言。
- 调试期间的 failed evidence 保留；最终 passing run 已在上表唯一标识。
- 未运行 `npm run check`，符合任务要求。
