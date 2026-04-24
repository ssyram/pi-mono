# steering-flow 执行行为文档

> **Line references** (`@file:line`) are approximate — they track the function/block, not exact lines. Use the function name to locate in source if a line has drifted.

以**由总到分**的结构组织。每个核心函数用 ≤5 行伪代码抽象核心流程，附 `@file:line` 引用。全篇无泔水、言之有物。

---

## A. 全流程概览

```
┌─ Plugin Init (index.ts:359) ───────────────┐
│  4 tools + 5 commands + 3 hooks             │
└─────────────┬───────────────────────────────┘
              │
    ┌─────────┴─────────┐ User/LLM triggers
    ▼                   ▼
┌───────┐         ┌────────────┐
│load   │         │action     │
│-flow  │         │-call      │
└───┬───┘         └─────┬──────┘
    │                   │
    ▼   withSessionLock │ (serialize per sessionId)
┌───────────────────────▼────────────────────────┐
│          Core Operations                       │
│  ┌─────────┐  ┌───────────┐  ┌─────────────┐  │
│  │ parser  │→ │  engine   │→ │   storage   │  │
│  │  (.ts)  │  │  (.ts)    │  │   (.ts)     │  │
│  └────┬────┘  └─────┬─────┘  └──────┬──────┘  │
       │              │                │         │
       ▼              ▼                ▼         │
  validation     runCondition    atomicWriteJson
                 (spawn+detsach)  tmp+rename
                                                 │
                     ┌───────────────────────────┘
                     ▼
             agent_end hook (index.ts:551)
             guards → stagnation check → sendUserMessage
```

---

## B. 初始化 `steeringFlow(pi)` @index.ts:359

```pseudo
fn steeringFlow(pi):
    for each tool: registerTool( ... execute wraps withSessionLock + try/catch )
    for each command: registerCommand(handler parses args → sends to LLM)
    pi.on("session_compact", record_timestamp)
    pi.on("agent_end", stop_hook_body)
    pi.on("session_start", clear_ts + sweep_tmp_files)
```

所有工具/command 共享模式：`withSessionLock(sessionId, () => coreOp(...))`。唯一例外是 `pop-steering-flow` **只注册为 command，不注册为 tool** (@index.ts:448) — LLM 无法自己 pop。

---

## C. 加载流程 `loadAndPush` @index.ts:114

```pseudo
fn loadAndPush(cwd, sessionId, filePath):
    absPath = resolve(cwd, filePath)
    stat(absPath) → reject if !isFile or >2MiB
    content = readFile(absPath)
    cfg = parseFlowConfig(content, absPath)        ← §D
    fsm = buildFSM(cfg)                            ← §D
```

```pseudo
    sessionDir = ensureSessionDir(cwd, sessionId)
    fsmId = newFsmId(flowName)
    writeFsmStructure(...) → writeState(..., "$START") → writeTape(...)
    pushFsm(sessionDir, fsmId)                     // stack.json updated
    // FSM fully on disk; snapshot complete
```

```pseudo
    try:
        entry = enterStart(rt, tapePath, cwd)      ← §G
        rt.tape = readTape(sessionDir, fsmId)      // condition side-channel writes
    catch e:
        popFsm(sessionDir); return {ok:false, error}
    if !entry.success:
        popFsm(sessionDir); return {ok:false, reasons}
    if entry.reached_end:
        popFsm(sessionDir); render parent flow
    persistRuntime(sessionDir, rt)                  // state.json only
    return renderStateView(rt)
```

**关键不变量**：任何失败路径都触发 `popFsm` 回滚（同时删 FSM 目录）。

---

## D. 解析器 `parser.ts`

### D.1 入口 `parseFlowConfig` @parser.ts:13

```pseudo
fn parseFlowConfig(content, filename):
    if byteLength(content) > 2MiB: throw
    content = normalize(CRLF→LF, strip BOM)
    ext = extract_extension(filename)
    raw = dispatch(ext == "json" ? JSON.parse : parseSimpleYaml)
    return validateFlowConfig(raw)
```

### D.2 YAML mini-parser

调度器 `parseYamlValue` @parser.ts:324：
```pseudo
fn parseYamlValue(lines, startLine, baseIndent, depth):
    if depth > 64: throw "nesting exceeds 64"
    skip blank/comment lines
    if line starts "- ": return parseYamlArray
    if line contains ":": return parseYamlObject
    else: return parseScalar(trimmed)
```

数组 `parseYamlArray` @parser.ts:349：
```pseudo
fn parseYamlArray(lines, start, baseIndent, depth):
    for line at baseIndent starting with "- ":
        afterDash = trim(line[2:])
        if afterDash contains ":" → inline object:
            obj = first key:val pair
            while deeper-indent continuation lines exist:
                if has ":": parseKeyValue / readBlockScalar / recurse
                else: throw "Unexpected non-key line"  ← strict, not silent skip
            push obj to result
        else: push parseScalar(afterDash)
```

对象 `parseYamlObject` @parser.ts:410：
```pseudo
fn parseYamlObject(lines, start, baseIndent, depth):
    for line at baseIndent:
        if indent > baseIndent: throw "Unexpected indentation"  ← strict
        parseKeyValue → if val: store; if blockScalar: readBlockScalar; else: recurse
```

标量 `parseScalar` @parser.ts:501：
```pseudo
fn parseScalar(s):
    "true"/"false" → bool; "null"/"~" → null
    quoted string → strip quotes
    Number(s) if valid number
    "{" or "[" → try JSON.parse → try regex-quote-keys → try again
    else: raw string
```

### D.3 验证链

```pseudo
fn validateFlowConfig(raw):
    if !isObject(raw): throw "must be object"
    task_description = raw.task_description must be non-empty string
    states = raw.states must be non-empty array
    for each s in states: validateState(s)
    return { task_description, states: Map }
```

```pseudo
fn validateState(raw):
    state_id = non-empty string matching IDENT_RE or $START/$END
    state_desc = non-empty string
    is_epsilon = !!raw.is_epsilon
    if state_id == "$END":
        if raw.actions?.length > 0: throw "$END cannot have actions"
        if is_epsilon: throw "$END cannot be epsilon"
        return { state_id, state_desc, is_epsilon, actions: [] }
    else:
        if !Array.isArray(raw.actions) or empty: throw "non-$END must have actions"
        actions = []
        for i, action of raw.actions:
            validateAction(action, state_id, is_epsilon, i==last)
    return { state_id, state_desc, is_epsilon, actions }
```

```pseudo
fn validateAction(raw, stateId, isEpsilon, isLast):
    action_id = matches IDENT_RE
    action_desc = string
    condition = validateCondition(...)
    next_state_id = exists in map && ≠ stateId
    arguments = must be array (reject mapping), each arg has arg_name (IDENT_RE)+arg_desc
    if isEpsilon and arguments.length > 0: throw "epsilon action cannot have arguments"
    return { action_id, action_desc, arguments, condition, next_state_id }
```

```pseudo
fn validateCondition(raw, actionId, stateId, isEpsilon, isLast):
    reject non-object / Array
    isDefault = (c.default === true)
    if isDefault and (cmd OR args present): throw "cannot mix default:true with cmd/args"
    if c.default !== undefined and c.default !== true: throw "default must be true or omitted"
    if isEpsilon:
        if isLast and !isDefault: throw "last epsilon action must have default:true"
        if !isLast and isDefault: throw "non-last epsilon action cannot use default:true"
    if !isEpsilon and isDefault: throw "non-epsilon cannot use default:true"
    cmd = must be non-empty string; path-like cmd must be ./../ prefix or absolute
    args = optional string[]
    // arg_name tokens in args: /^[A-Za-z0-9_-]+$/, ${arg-name} interpolated at runtime
    // special placeholder ${$TAPE_FILE} replaced with absolute tape.json path
    return isDefault ? {default:true} : {cmd, args?}
```

```pseudo
fn buildFSM(config):
    states = Map()
    for s in config.states:
        if states.has(s.state_id): throw duplicate
        states.set(s.state_id, s)
    if !$START in states: throw
    if !$END in states: throw
    for s in config.states:
        for a in s.actions:
            if action_id duplicates: throw
            if !states.has(a.next_state_id): throw
            if a.next_state_id == s.state_id: throw self-loop
    Forward BFS from $START; if !$END reachable: throw deadlock
    Reverse BFS from $END (via reversed edges); for each fwd-reachable state:
        if not reverse-reachable: throw "dead-end state: X, Y, ..."
    return { task_description, states }
```

双向 BFS 保证：(1) $START 能到 $END，(2) **每个可达状态都能到 $END**（无死点）。

---

## E. 存储层 `storage.ts`

### E.1 原子写入 `atomicWriteJson` @storage.ts:37

```pseudo
fn atomicWriteJson(path, data):
    tmp = path + ".tmp." + pid + "." + randomHex
    await writeFile(tmp, JSON.stringify(data))
    await rename(tmp, path)  // POSIX atomic same-fs
```

崩溃在两步之间 → tmp 残留 → `sweepTmpFiles` 清理。

### E.2 严格读取 `readJsonStrict` @storage.ts:45

```pseudo
fn readJsonStrict<T>(path):
    try readFile(path)
    catch ENOENT: return undefined
    catch other: rethrow
    try JSON.parse(text): return T
    catch: throw CorruptedStateError(path, cause)
```

### E.3 会话锁 `withSessionLock` @storage.ts:66

```pseudo
fn withSessionLock<T>(sessionId, fn):
    prev = locks.get(key) ?? Promise.resolve()
    prevSettled = prev.then(swallow, swallow)
    next = prevSettled.then(fn)
    tail = next.then(swallow, swallow)  ← the settled version
    locks.set(key, tail)
    try: return await next
    finally: if locks.get(key) === tail: locks.delete(key)  ← identity check on tail
```

**关键点**：存和比较的是同一个 `tail` 引用（不是两次独立调用`.catch()`），保证 Map 能正确清理。

### E.4 栈操作与 FSM 文件

| 函数 | 语义 |
|---|---|
| `readStack` | `readJsonStrict` → filter strings |
| `pushFsm` | read → append → write |
| `popFsm` | read → pop → write → **rm FSM dir** |
| `writeFsmStructure` | fsm.json |
| `writeState` | state.json (+ optional reminder_meta + preserve_entered_at) |
| `readTape` | tape.json (preserves all JSON value types) |
| `writeTape` | atomicWriteJson(tape.json) |
| `loadRuntime` | combine fsm/state/tape reads into FSMRuntime |
| `newFsmId` | timestamp-slug-randomhex |
| `sweepTmpFiles` | scan & delete `.tmp.*` (skip own-pid) |

---

## F. 引擎：条件执行 `runCondition` @engine.ts:40

```pseudo
fn runCondition(condition, tapePath, llmArgs, cwd, flowDir):
    if condition.default: return { ok: true, reason: "default transition" }
    cmd = resolveTokenRelToFlow(condition.cmd, flowDir)
    configArgs = condition.args.map(resolveTokenRelToFlow)
    argv = configArgs.map(tok => interpolate(tok, tapePath, llmArgMap))
    // ${$TAPE_FILE} -> tapePath; ${arg-name} -> llmArgMap[arg-name]
```

```pseudo
    try:
        child = spawn(cmd, argv, { detached: true, stdio: [ignore, pipe, pipe] })
    catch: return { ok: false, reason: "spawn-error" }
```

```pseudo
    timer = setTimeout(30s → settle(timeout reason))
    stdoutChunks[], stderrChunks[] with byte counters
    each chunk: if remaining bytes ≤ cap: append; else: truncate, set flag
    close event: Buffer.concat(chunks).toString("utf-8") → split("\n") → first line → { ok, reason }
    error event: settle(spawn-error)
    settle(): if settled return; settled=true; clearTimeout; killTree(); resolvePromise
```

**进程组杀死** @engine.ts:82：
```pseudo
killTree():
    try process.kill(-child.pid, "SIGKILL")  // negative PID → pgrp
    catch: try child.kill("SIGKILL")
```

> **Design decision — SIGKILL truncation accepted**: Condition processes write `tape.json` directly via the `${$TAPE_FILE}` path. If a condition is killed mid-write (e.g., 30 s timeout → SIGKILL), `tape.json` may be left truncated. This is an inherent property of the external-process condition model and is accepted. The interrupt is absolute — if the tool did not report completion via stdout, the write is considered interrupted. Callers must treat a post-SIGKILL `tape.json` as potentially corrupt and rely on the re-sync (`rt.tape = readTape(...)`) to detect parse failures.

**首行解析**：
```pseudo
first = lines[0].trim().toLowerCase()
if first == "true": return { ok: true, reason: rest || "true" }
if first == "false": return { ok: false, reason: rest || stderr || "false (no reason)" }
else: return { ok: false, reason: "malformed: got '${first}'. exit=${code}. stderr=..." }
```

---

## G. 引擎：状态转移

### G.1 `executeAction` @engine.ts:165

```pseudo
fn executeAction(runtime, actionId, positionalArgs, tapePath, cwd):
    state = runtime.states[runtime.current_state_id]
    if !state: return fail("current state not found")
    if state.is_epsilon: return fail("cannot invoke epsilon state explicitly")
    action = state.actions.find(a => a.action_id === actionId)
    if !action: return fail("unknown action", available list)
    if positionalArgs.length !== action.arguments.length:
        return fail("arg count mismatch", expected signature)
```

```pseudo
    condResult = runCondition(action.condition, tapePath, positionalArgs, cwd, runtime.flow_dir)
    if !condResult.ok: return fail(reason)  // state unchanged
    snapshot = runtime.current_state_id      // ← rollback anchor
    chain.push({from, to, action_id, reason, timestamp})
    runtime.current_state_id = action.next_state_id
    if current_state_id == "$END":
        return { success: true, chain, reached_end: true, end_desc }
```

```pseudo
    epsilonResult = chainEpsilon(runtime, chain, tapePath, cwd)
    if !epsilonResult.ok:
        runtime.current_state_id = snapshot  // ← ROLLBACK (current_state_id only)
        return fail("epsilon failed", epsilonError)
    return { success: true, chain, reached_end: current_state_id == "$END" }
```

> **Design decision — tape is cumulative, never rolled back**: When a transition fails (including epsilon chain failures above), only `current_state_id` is restored to the snapshot. Any tape mutations that conditions wrote to `tape.json` during that attempt are **preserved on disk**. This is intentional: conditions write to tape as side effects representing work that was done regardless of whether the state transition ultimately succeeded. If full transactional rollback is needed, the recommended approach is git-based tape management external to steering-flow.

### G.2 `chainEpsilon` @engine.ts:286

```pseudo
fn chainEpsilon(runtime, chain, tapePath, cwd):
    depth = 0
    while depth < 64:
        state = runtime.states[runtime.current_state_id]
        if !state: return error("state not found")
        if !state.is_epsilon: return ok
        if current == "$END": return ok
        matched = null; matchedReason = ""
        for act in state.actions (in declared order):
            res = runCondition(act.condition, tapePath, [], cwd, runtime.flow_dir)
            if res.ok: matched = act; matchedReason = res.reason; break
        if !matched: return error("no matching condition")
        chain.push({from, to, act.action_id, reason, timestamp})
        runtime.current_state_id = act.next_state_id
        depth++
    return error("depth exceeded 64")
```

解析器保证 epsilon 的最后一个 action 是 `{default:true}` → always matches → no deadlocks.

> **Design decision — `transition_log` records only committed transitions**: Every successful hop in an epsilon chain (including all intermediate states) is pushed to `transition_log` once the full chain succeeds. If the epsilon chain fails partway through, `current_state_id` is rolled back and **none of the failed hops are added to `transition_log`** — only transitions that are actually committed to `state.json` appear in the log.

### G.3 `enterStart` @engine.ts:331

```pseudo
fn enterStart(runtime, tapePath, cwd):
    snapshot = runtime.current_state_id  // "$START"
    result = chainEpsilon(runtime, empty_chain, tapePath, cwd)
    if !result.ok: runtime.current_state_id = snapshot; return fail
    return TransitionResult(chain, success, reached_end)
```

---

## H. 核心操作 (`index.ts`)

### H.1 `actionCall` @index.ts:219

```pseudo
fn actionCall(cwd, sessionId, actionId, args):
    fsmId = topFsmId(sessionDir)
    rt = loadRuntime(sessionDir, fsmId)
    tapePath = tapePathFor(sessionDir, fsmId)
    result = executeAction(rt, actionId, args, tapePath, cwd)
    rt.tape = readTape(sessionDir, fsmId)  // re-sync condition writes
    if result.success: persistRuntime(sessionDir, rt)  // only on success
    if result.reached_end: popFsm; render parent
    return renderTransitionResult(rt, result)
```

**只在成功时持久化** (@index.ts:242) — 失败时 `executeAction` 已回滚 `current_state_id`，不写磁盘。

### H.2 `persistRuntime` @index.ts:103

```pseudo
fn persistRuntime(sessionDir, rt):
    writeState(sessionDir, rt.fsm_id, ...)        // state.json only
```

> **Design decision — `persistRuntime` only writes `state.json`**: Tape is managed independently. Condition scripts write `tape.json` directly via `${$TAPE_FILE}`, and the `save-to-steering-flow` tool writes tape via `writeTape`. `persistRuntime` does **not** call `writeTape` — doing so would overwrite tape changes already made by condition scripts during the same transition.

### H.3 `saveCall` @index.ts:263

```pseudo
fn saveCall(cwd, sessionId, id, value):
    if byteLength(value) > 64KiB: return error
    tape = readTape(sessionDir, fsmId)
    if !(id in tape) and keys ≥ 1024: return error
    tape[id] = value
    writeTape(...)
    return confirmation message with truncated preview
```

### H.4 `infoCall` @index.ts:284

```pseudo
fn infoCall(cwd, sessionId):
    stack = readStack(sessionDir)
    for each fsmId in stack:
        try: rt = loadRuntime(sessionDir, fsmId)
        catch: append "⚠️ CORRUPTED" + friendlyError; continue
        append rendered FSM details (name, task, state, tape)
    // For top FSM: also render full state view
    return joined lines
```

**单个 FSM 损坏不会让整个命令崩溃** (@index.ts:294-298)。

### H.5 `popCall` @index.ts:335

```pseudo
fn popCall(cwd, sessionId):
    popped = popFsm(sessionDir)
    if !popped: return "(empty stack)"
    remaining = readStack(sessionDir)
    text = `Popped ${fsmId}. Stack: ${remaining.length}`
    if remaining.length > 0: text += "\n\n" + renderStateView(parent)
    return text
```

---

## I. Stop Hook `agent_end` @index.ts:551

### I.1 Guard 链（按顺序，任一为真即 return）

| # | Guard | 行 | 检查内容 |
|---|---|---|---|
| 1 | 信号中止 | @index.ts:558 | `ctx.signal?.aborted` |
| 2 | 用户 abort | @index.ts:559 | `AssistantMessage.stopReason === "aborted"` |
| 3 | 压缩冷却 | @index.ts:569 | 距上次 `session_compact` 不足 30 秒 |

> **Design decision — stop hook is fully automatic**: steering-flow is fully automated. The stop hook **always** re-injects state when the LLM stops mid-flow (before `$END`). There is no question detection and no confirm-to-stop mechanism. The only way to stop the loop is reaching `$END` or the user manually calling `/pop-steering-flow`. The only guard beyond user abort is the 30-second compaction cooldown (per-session) to avoid re-injecting immediately after context compaction.

### I.2 主体（在 `withSessionLock` 内）

```pseudo
stack = readStack(sessionDir)
if stack.empty: return
rt = loadRuntime(topId)
if !rt or rt.current_state_id == "$END": return
hash = SHA1(state_id + "\0" + stableStringify(tape))
prevHash, prevCount = readState()?.last_reminder_hash/count ?? 0
nextCount = (hash === prevHash) ? prevCount + 1 : 1
```

```pseudo
if nextCount > 3 (STAGNATION_LIMIT):
    notify("stagnation detected, reminders paused")
    writeState(... count=nextCount, hash=hash, preserve_entered_at)
    return  // 不发提醒
writeState(... count=nextCount, hash=hash, preserve_entered_at)
render reminder via renderStateView with instruction header
pi.sendUserMessage(reminder)
```

> **Design decision — stagnation counter freeze on ENOSPC accepted**: `writeState` (which persists `reminder_count` to `state.json`) is called inside the stop hook's outer `try/catch` that swallows all errors. If `writeState` fails due to ENOSPC, `reminder_count` is not updated on disk; the counter freezes at its previous value and the user may receive repeated reminders beyond the stagnation limit. This is accepted: ENOSPC indicates a system-level failure beyond steering-flow's scope, and propagating the error from the stop hook would risk crashing the agent on disk-full conditions.

**自愈**：成功转移后 `persistRuntime` 写 `state.json` 不带 `reminder_count` → 下次 hook 读到 `undefined` → counter 重置为 1。

### I.3 `stableStringify` @index.ts:87

```pseudo
fn stableStringify(v):
    if v === undefined: return "null"
    if v === null or typeof v !== "object": return JSON.stringify(v)
    if Array.isArray(v): return "[" + map(stableStringify, join(",")) + "]"
    keys = sort(Object.keys(v))
    return "{" + map(k => k + ":" + stableStringify(v[k]), join(",")) + "}"
```

递归排序 keys → 相同的值无论插入顺序都产生同一 hash。

---

## J. 渲染 `engine.ts:360-432`

### `renderStateView`

输出流：
1. Flow name
2. Task description
3. Current state ID + description
4. `(epsilon / auto-routing state)` if applicable
5. `$END` completion marker
6. Actions list (each: `action_id`: desc `args: [<arg_name: desc>, ...]`)
7. Tape keys (names only)

### `renderTransitionResult`

- **Success**: `✅ Transitioned: A → B → C`, reasons per hop, then `renderStateView` (or `$END` message).
- **Failure**: `❌ State unchanged`, reasons, then `renderStateView` + hint about tape.

---

## K. 辅助模块

### `stop-guards.ts`

| 函数 | 行 | 功能 |
|---|---|---|
| `findLastAssistant` | @stop-guards.ts:8 | Reverse scan for role=="assistant" |
| `wasAborted` | @stop-guards.ts:18 | `last.stopReason === "aborted"` |

---

## L. 数据流图

```
Load flow:
User/LLM → tool/command → withSessionLock → loadAndPush
 → stat/read → parseFlowConfig → buildFSM
 → write fs(fsm.json + state.json + tape.json) → pushFsm
 → enterStart (chainEpsilon → runCondition → spawn)
 → persistRuntime (state.json only) → renderStateView → response

Action flow:
User/LLM → tool/command → withSessionLock → actionCall
 → loadRuntime → executeAction
   → runCondition (spawn, timeout, caps, settled guard)
   → snapshot → advance → $END check? → chainEpsilon → rollback on failure
 → readTape (re-sync)
 → persistRuntime (only if success) → popFsm if $END → renderTransitionResult → response

Stop hook:
agent_end → guards (abort/compaction)
 → withSessionLock
 → readStack → loadRuntime → compute stagnation hash
 → if count > 3: notify & return
 → writeState(count/hash/preserve) → sendUserMessage(reminder)
```

---

## M. 错误传播矩阵

| 入口点 | 可能错误 | 捕获位置 | 用户/LLM 看到 |
|---|---|---|---|
| load tool | file missing/too large | `loadAndPush` returns `{ok:false}` | tool result (isError:true) |
| | parse/build failure | `loadAndPush` return `{ok:false}` | "Failed to parse flow config: ..." |
| | enterStart throw | `try/catch` in `loadAndPush` → popFsm | "Flow X failed during $START entry; stack rolled back" |
| | disk write failure | tool outer try/catch | `friendlyError(e)` |
| action tool | no active FSM | `actionCall` returns ❌ text | tool result (not isError) |
| | unknown action / wrong arg count | `executeAction` returns fail | "unknown action 'X'" + available list |
| | condition timeout/malformed | `runCondition` returns `{ok:false}` | Same as above |
| | CorruptedStateError | tool outer try/catch | "steering-flow corrupted state: ..." with recovery tip |
| save tool | value too big / key limit | `saveCall` returns ❌ text | tool result |
| info tool | middle FSM corrupted | `infoCall` per-FSM catch | "⚠️ CORRUPTED" + continue rendering others |
| pop command | empty stack | `popCall` returns text | "/pop-steering-flow returned '(empty stack)'" |
| Stop hook | any exception | outer try/catch swallows | **silent** (hooks can't crash) |
| | CorruptedStateError | inner try/catch | `ctx.ui.notify` if ctx.hasUI |

---

## N. 并发模型

**为什么需要锁**：pi 框架在同一 turn 内并行执行多个工具调用 (@agent-loop.ts:390-438)。两个并发 `steering-flow-action` 对同一个 `stack.json` / `state.json` 做 RMW 会丢失更新。

**锁范围**：
- `withSessionLock(sessionId, fn)` — 同一 sessionId 下所有 RMW 操作串行
- 锁在 `fn` 返回后释放 — `pi.sendUserMessage` 是异步排队，不持锁等待
- `agent_end` handler 也走锁 → 如果有并发 tool call 未完成，hook 等待
- `sweepTmpFiles` 不走锁（在 `session_start` 时运行，此时还没有 tool call）

**不覆盖**：跨进程（极罕见场景；原子写入防损坏但不防丢失更新）。

---

## O. 运行时不变量

| 操作类型 | 完成后的保证 |
|---|---|
| 成功 load | stack 有新 top；FSM 目录完整；state.json 在初始状态 |
| 失败 load | stack 不变（已回滚）；FSM 目录已删 |
| 成功 action | state.json = 新状态；tape.json = 最新（含条件脚本写入） |
| 失败 action | state.json 不变（不写磁盘）；runtime.current_state_id 已回滚；**tape.json 的条件写入已保留**（tape 不回滚，见 G.1 设计决策） |
| 到达 $END | FSM 目录已删；stack 已 pop；父流程（如有）成为新 top |
| save | tape.json 已更新 |
| pop | FSM 目录已删；stack 已更新 |
| Stop hook 提醒 | state.json 含 reminder_count + hash；entered_at 未被覆盖 |
| 成功转移后 | reminder_count 被 persistRuntime 覆盖（不含该字段）→ 自动重置为 0 |

---

## P. 磁盘布局

```
.pi/steering-flow/<SESSION-ID>/
├── stack.json                           — string[] of FSM-IDs (末尾 = 栈顶)
└── <FSM-ID>/                            — newFsmId 生成 (timestamp-slug-hex)
    ├── fsm.json                         — 完整状态机结构 + flow_dir
    ├── state.json                       — current_state_id + entered_at + chain + reminder meta
    └── tape.json                        — Record<string, TapeValue>
```

所有 `.json` 文件通过 `atomicWriteJson`（tmp+rename）写入。`sweepTmpFiles` 在 `session_start` 清理崩溃残留的 `.tmp.*` 文件。

---

## Q. 类型定义 `types.ts`

| 类型 | 说明 |
|---|---|
| `Condition` | 判别联合：`{default:true}` ∣ `{cmd, args?}` |
| `Action` | action_id + action_desc + arguments + condition + next_state_id |
| `State` | state_id + state_desc + is_epsilon + actions[] |
| `FSMRuntime` | fsm_id, flow_name, **flow_dir**, task_description, states, current_state_id, tape, transition_log |
| `TransitionResult` | success + chain[] + final_state_id + reasons + reached_end + end_desc |
| `TapeValue` | 递归 JSON 值类型（string ∣ number ∣ boolean ∣ null ∣ TapeValue[] ∣ {[k]: TapeValue}） |
