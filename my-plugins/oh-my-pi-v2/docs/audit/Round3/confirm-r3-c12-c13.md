# Round 3 Independent Confirmation: R3-C12 through R3-C13

Scope: current docs/source only. Read inputs: `docs/audit/Round3/round-context.md`, `docs/audit/Round3/candidates.md`, `README.md`, `docs/deployment-guide.md`, `hooks/boulder.ts`, and `hooks/boulder-countdown.ts`. Did not inspect Round1/Round2 audit dirs.

## R3-C12: README recommended-extension list is stale vs deployment guide

**Verdict: CONFIRMED**

Candidate claim: README omits `pi-intercom` and recommends `pi-mcp-adapter` differently than the deployment guide.

Evidence from `README.md`:

- `README.md:19-25` has a “Required Extension” section for only `pi-subagents`:
  - `README.md:22` says `pi install npm:pi-subagents`.
  - `README.md:25` describes `pi-subagents` as providing the `subagent` tool.
- `README.md:27-35` has a “Recommended Extensions” section that installs `pi-mcp-adapter` and `pi-web-access`:
  - `README.md:30-31` describes and installs `pi-mcp-adapter`: “MCP server proxy (~200 token overhead, lazy lifecycle, OAuth)” / `pi install npm:pi-mcp-adapter`.
  - `README.md:33-34` describes and installs `pi-web-access`.
- `README.md:37-41` table lists `pi-subagents`, `pi-mcp-adapter`, and `pi-web-access`; there is no `pi-intercom` entry in that list.
- Targeted grep of README extension references found hits for `pi-subagents`, `pi-mcp-adapter`, and `pi-web-access`, and no `pi-intercom` hit.

Evidence from `docs/deployment-guide.md`:

- `docs/deployment-guide.md:7-15` dependency table marks `pi-web-access` as “推荐” and `pi-intercom` as “推荐”; it marks `pi-subagents` and Node.js as required.
- `docs/deployment-guide.md:71-81` Step 5 recommends companion extensions and explicitly installs:
  - `pi install npm:pi-web-access`
  - `pi install npm:pi-intercom`
- `docs/deployment-guide.md:83-99` Step 6 labels other nicobailon extensions optional and includes `pi-mcp-adapter` there, not in Step 5’s recommended pair.
- `docs/deployment-guide.md:127-129` one-click script installs `pi-web-access` and `pi-intercom` under “推荐”.
- `docs/deployment-guide.md:139-149` ecosystem table marks `pi-intercom` as “推荐” and `pi-mcp-adapter` as “可选”.

Conclusion: current README recommends `pi-mcp-adapter` and omits `pi-intercom`, while the current deployment guide recommends `pi-intercom` and treats `pi-mcp-adapter` as optional. The candidate is confirmed.

## R3-C13: Boulder user-facing/source wording still says pending tasks for actionable tasks

**Verdict: CONFIRMED**

Candidate claim: `hooks/boulder.ts` restart message and `hooks/boulder-countdown.ts` comments/labels say pending tasks while source semantics pass actionable count/tasks.

Evidence that current Boulder semantics use actionable tasks:

- `hooks/boulder.ts:29-33` defines `TaskState` with both `pendingCount` and `actionableCount`, plus `readyTasks`.
- `hooks/boulder.ts:94-100` reads `actionableCount` from `getTaskState()` and returns when `actionableCount === 0`.
- `hooks/boulder.ts:155-172` re-fetches state before restart, returns when `fresh.actionableCount === 0`, builds the restart message with `fresh.actionableCount`, and starts the countdown with `actionableCount`.
- `hooks/boulder.ts:181-186` defines the actionable task list as `in_progress` tasks plus `readyTasks`:
  - `return [...tasks.filter((t) => t.status === "in_progress"), ...readyTasks];`

Evidence of remaining pending wording/names for actionable data:

- `hooks/boulder.ts:124-147` comment says “Compare actionable task IDs,” but the variable storing those IDs is named `currentPendingIds`; the restart message is then built with `actionableCount`.
- `hooks/boulder.ts:207-218` `handleStagnation(...)` names the count parameter `pendingCount` and emits: `Agent appears stuck after ${stagnationCount} restarts with no progress (${pendingCount} tasks still pending).`
- `hooks/boulder.ts:235-257` `buildRestartMessage(...)` names the count parameter `pendingCount`, stores `getActionableTasks(...)` into a variable named `pending`, and emits the user-facing line: `You have pending tasks that are not complete:`.
- `hooks/boulder-countdown.ts:22-25` documents the third `startCountdown` parameter as `pending    Number of pending tasks (shown in status text)`.
- `hooks/boulder-countdown.ts:28-32` names that parameter `pending`.
- `hooks/boulder-countdown.ts:37-41` renders status text with that value: `Restarting in ${remaining}s (${pending} tasks) — press Esc to cancel`.

Conclusion: current runtime semantics use actionable tasks/counts (`in_progress` plus ready/unblocked pending), but source names/comments and user-facing messages still use pending terminology for those actionable values. The candidate is confirmed.
