# 细化：Verification Plan

## 自动层

```bash
node --test --import tsx my-plugins/codex-viewport/*.test.ts
npx tsc -p my-plugins/codex-viewport/tsconfig.json
```

当前revision：88 tests / 16 suites；56个非测试TS文件、20个`*.test.ts`文件。Local code contract通过Round 006复审；跨terminal/IME production proof仍为`NOT PROVEN`。

覆盖：

- source-order finalized frontier与generated completion permutations；
- DSR adjacent input、timeout、late response和cancel；
- stable submitted-message prefix不被`EL2`；
- short native layout保持variable bottom；
- downward growth后裁pending顶部，不移动stable rows；terminal-bottom最终策略仍是D层决策门；
- finalized visual block原子baseline adoption、无第二次native render与managed suffix re-entry；
- nonzero physical origin、retained viewport超过logical tail、Footer后bottom slack与后续官方Pi native diff；
- `agent_end` continuation保持managed、`agent_settled`才drain；
- snapshot direct stop在capture和artifact publication阶段均abort；64 MiB cap crossing；
- task/status在commit observation间变更时取消prepared commit、保持managed owner、下一帧再提交；
- pending → finalized custom/tool suffix的顺序与冻结；
- 同一transaction prepare/paint使用一次component render observation；
- Editor/footer/widget/live priority；
- elapsed widget `2m13s→9m55s`无CRLF/旧bytes；
- terminal height managed rebase；
- width一次mandatory native full redraw、第二次DSR和managed re-entry；dirty gate失败/stop的native catch-up；
- width recapture期间agent end取消；无dirty update时不产生额外native render；
- image/visible overlay/Ctrl+O/write failure fallback；
- TUI stop/shutdown与native handoff；
- AI-visible payload与abort不变。

## Global Pi smoke（历史证据，早于Round 005修复）

Startup：

```bash
pi -ne -e ./my-plugins/codex-viewport/index.ts --no-session
```

Deterministic faux provider执行24次tool progress与80行final assistant，不调用外部API。

### Demand-driven 100x30

```text
DSR=1
sync frames=260 (timing-dependent)
2J=0 3J=0
history regions=9
warnings=0
mid-run submitted message visible=true
mid-run Editor/footer visible=true
final line 79 visible=true
```

### Width re-entry 100→80

```text
DSR=2
2J=1 3J=1
managed frames after second DSR=255
warnings=0
submitted message visible=true
final line 79 visible=true
```

该历史结果不能证明当前revision；它仅曾观察到一次native reflow后恢复managed ownership，也不证明Apple Terminal IME安全。

Hidden-overlay integration：同时加载`my-plugins/docker`的persistent hidden overlays后，overlay warning 0，managed rendering正常。

## 必跑项目检查

```bash
npm run check
git diff --check -- my-plugins/codex-viewport
```

## 尚未完成

- Apple Terminal直接中文composition/candidate/commit/cancel；
- iTerm2/Kitty/WezTerm；
- Zellij；
- real subagent extension高频widget/retention；
- active abort/error/retry、Ctrl+Z与external editor真实tmux；
- hard SIGKILL + persisted session reopen；
- direct stdout foreign writer characterization。
