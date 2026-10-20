# 首次真实 E2E（mock LLM + 真实 FSM daemon + 官方 Pi 宿主）

状态：**核心门禁链路验证通过**。零真实模型 token（mock-llm-server 全程承载）。

## 环境

- mock-llm-server（~/workspace/ai-tools/mock-with-pi）@18001，挂载 /tmp/fsm-e2e/fsm-e2e-actor.mjs（无状态脚本：enter_fsm→允许探针→禁止探针→汇总）。
- 真实 FSM daemon 0.11.0/wire2/schema2（use-fsm/target/release），隔离 FSM_DATA_DIR=/tmp/fsm-e2e/fsm-data；注册 GateProbeE2E skill（S_probe blacklist bash.*FSM_E2E_FORBIDDEN.*）。
- 官方 Pi 1.0.3（/opt/homebrew/bin/pi）于 /tmp/fsm-e2e/project，--model fsm-mock/fsm-actor（pi.registerProvider→mock baseURL）。
- 插件 config（my-plugins/fsm-compatible/fsm-compatible.config.json）：dataDir 指向隔离 FSM 数据；组装后桥 listen、source 六字段注册成功（agent-sessions.json 记录真实 pid/桥地址）。

## 发现并修复的两个真实缺陷

1. **check-permission 响应形状不匹配**：daemon 返回 `{allowed,reason?}` 而非 `{ok:true,...}`；permission-gate 误用 requireDaemonOk 导致一切调用"不可达"fail-close。修复为直接形状校验（gates 测试同步）。
2. **stop-check 响应形状不匹配**：daemon 返回 `{is_terminal}` 而非 `{allowed}`；stop-gate 同样误用 requireDaemonOk。修复为 is_terminal 映射 allowed（transport 失败仍 soft-gate）。

## 验证结果（第二轮修复后真实运行）

1. **enter_fsm 真实工作**：mock 调 `mcp__fsm__enter_fsm{name:GateProbeE2E}` → 进入 S_probe（工具结果含 state 视图）。
2. **允许探针通过**：`bash echo FSM_E2E_ALLOW_PROBE_OK` → check-permission → `{allowed:true}` → 命令真实执行输出标记。
3. **禁止探针被 FSM 拦截**：`bash echo FSM_E2E_FORBIDDEN rm -rf /` → check-permission → S_probe 黑名单拒绝（结果含 "blacklisted in state S_probe"），命令未执行。
4. **Stop 门禁真实触发**：S_probe 非终态 → stop-check is_terminal=false → 追加 `[fsm-compatible:stop] FSM Stop: continue required` 续跑（mock 脚本未处理续跑导致循环——门禁行为正确）。
5. 首轮（修复前）另验证了 fail-close：check-permission 不可达时两条探针都被拒绝、命令未执行——失败方向安全。

## 第二轮：完整生命周期验证（enter→探针→self-check→transition→Stop）

skill 更新为 S_probe→S_exit（hard guard `test -f done.marker`），mock 脚本 7 步：enter_fsm→允许探针→禁止探针→写 marker→fsm_submit_self_check→fsm_try_transition→最终汇总。

结果：
- ✅ enter_fsm 真实进入 S_probe（工具结果含完整 state 视图）
- ✅ 允许探针执行（`FSM_E2E_ALLOW_PROBE_OK`）
- ✅ 禁止探针被 FSM 拦截（"blacklisted in state S_probe"）
- ✅ marker 写入通过（非黑名单 bash 允许）
- ✅ fsm_submit_self_check / fsm_try_transition 被插件真实投影并调达 daemon
- ✅ Stop 门禁在非终态正确强制续跑（is_terminal=false → continue）
- 迁移返回 409：self-check 参数格式与 daemon 期望不匹配（mock 脚本 API 使用细节，非插件缺陷——插件投影链路完整，工具调用确实到达了 daemon 并得到真实响应）
- 循环同理：Stop 门禁正确阻塞非终态退出，mock 未处理续跑轮次

**结论**：插件在真实 FSM daemon + 官方 Pi + mock LLM 下，核心门禁生命周期（enter/permission/deny/Stop/FSM工具投影）全部真实验证通过。迁移/self-check 的 409 是 mock 脚本参数格式问题，不涉及插件链路缺陷。

- 循环是 mock 脚本设计问题（assistantTurns≥3 后每轮都输出 summary，而 Stop gate 不断续跑），不是门禁缺陷；后续 mock 加 exit_fsm 分支即可收尾。
- `AskUserQuestion` 工具在有 UI 会话已注册（tmux 有 UI），本轮未触发问答路径。
- 判定 judge/child 派发链路未被本轮覆盖（需后续场景）。

全程无真实 provider token；误耗仅第一次手动 smoke 的 $0.026（此前已披露）。

## 第三轮：完整干净生命周期（enter→探针→self-check→transition→exit_fsm→Stop放行）

mock 脚本八步：enter→允许探针→禁止探针→marker→self_check(S_exit)→transition(S_exit)→self_check(_fsm_exit)→exit_fsm→最终文本。

**全部通过，干净结束，无循环：**
- ✅ enter_fsm 进入 GateProbeE2E/S_probe
- ✅ 允许探针 `bash echo FSM_E2E_ALLOW_PROBE_OK` 真实执行
- ✅ 禁止探针 `bash echo FSM_E2E_FORBIDDEN rm -rf /` 被FSM状态黑名单拦截（"blacklisted in state S"）
- ✅ marker 写入通过
- ✅ self_check(target=S_exit, checks=[]) 接受
- ✅ transition(S_exit) 成功（current_state: S_exit）
- ✅ self_check(target=_fsm_exit, checks=[]) 接受
- ✅ exit_fsm 成功——回到 _default 状态（"is_exit_state": true, "available_transitions": []）
- ✅ **Stop 门禁放行**：is_terminal=true，最终文本输出，Agent 干净结束，Recap 正常生成

**这是插件在真实 FSM daemon + 官方 Pi + mock LLM 下的完整干净端到端验证：进入FSM→门禁拦截→状态迁移→退出FSM→干净停止，全部通过。**
