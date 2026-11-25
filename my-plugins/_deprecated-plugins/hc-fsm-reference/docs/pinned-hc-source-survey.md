# HC native agents and FSM integration: read-only launch research

## Scope and provenance

- **H** means `/Users/ssyram/workspace/ai-tools/haokun-code` at `e81af70d789a33d67a25e158604e9bd6c9325bfd`. `git rev-parse HEAD` matched. Citations below are repository-relative `path:line` at that revision.
- **F** means `/Users/ssyram/workspace/ai-tools/mcp-server-fsm`, **object** `216f7aabac78956dbafce45ef4b1edbb65dd0507`. Read with `git show`, `git grep <object>`, and `git ls-tree`; no checkout or dependence on its current worktree.
- Read H `AGENTS.md`, `packages/opencode/AGENTS.md`, HTTP API `AGENTS.md`; F `AGENTS.md` is a symlink whose object contents are `CLAUDE.md`, so its target was also read.
- `/Users/ssyram/bin/opencode` is a symlink to `/Users/ssyram/workspace/work-fv/c-code-verify/.local/haokun-code-release-inspect/v1.18.31-fmv2.1/opencode-darwin-arm64/bin/opencode`. Version `1.18.31-fmv2.1` is supplied by the task, **not independently executed or byte-attested** here.
- No HC/FSM files, package files, or references were changed. No providers, servers, installers, tests, or reviews were run. The only authored file is this requested report. H status before and after was exactly `?? packages/tui/tmux`; that untracked file was **not read**. Both H and the pi repository had empty staged-file listings.

## Launch recommendation

**Proceed only to an explicitly authorized, scratch-only, loopback headless probe. First establish the native four-tool contract with external plugins disabled; then use a separate scratch environment for the pinned FSM plugin. Do not treat the FSM phase as a prerequisite for native agent behavior.**

The load-bearing distinction: HC reports a child run ending to its direct parent independently of the FSM plugin. The plugin evaluates a normally completed assistant turn **after idle**, asynchronously, and may re-prompt that child. There is no source-level synchronization that makes the native parent report wait for an FSM Allow. Thus an idle event or `Agent completed:` notice is not evidence of FSM permission to Stop. See the ordering section and trace ledger below.

Do not launch in either source repository, inherit the user's environment/profile, run an installer, invoke the full-e2e harness, or patch product code to suppress initialization. A proposed local provider configuration is below; no provider implementation or execution was performed.

## Native tools: schema, outputs, and addressing

### Model-visible parameter shapes

These are HC's own Effect schema fields, before any provider-specific schema transformation:

```text
agent({ description: string, prompt: string, subagent_type: string,
        name?: string, cwd?: string })
agent_list({})
agent_send({ target: string, message: string })
agent_stop({ target: string })
```

`description`, `prompt`, and `subagent_type` are required plain strings. There is no model-facing `async`, `wait`, notification switch, session override, model override, or variant override. The “3–5 word” description is documentation, not a string-length constraint. Creation is always asynchronous. H `packages/opencode/src/tool/agent.ts:14-56,61-74,135-167`.

The registry appends available non-primary agent definitions to the spawn description, filtering types denied by the current agent permission. It invokes plugin `tool.definition`, and the final schema is also transformed for the selected provider. Capture the actual model request's tools for wire-level evidence rather than assuming a verbatim JSON Schema serialization. H `packages/opencode/src/tool/registry.ts:295-310,362-390`; `packages/opencode/src/session/tools.ts:92-103`.

### Success outputs

`agent` returns title = description; metadata has `parentSessionId`, child `sessionId`, and the child's resolved `{providerID, modelID}`. Its text is:

```text
Started <agent_type> agent[ "<name>"].
session_id: <child-id>
[name: <name>]
working directory: <path>
[note: <workspace-note>]

It is running in the background. Its result will arrive as a message when it finishes.
Use agent_list for its current status.
```

Bracketed lines/fragments above indicate optional fields, not literal output. This text is not an authoritative busy-status observation: the code notes that the job may not yet have started. H `packages/opencode/src/tool/agent.ts:168-202`.

`agent_list` returns title `agents`, metadata `{count}`, and a TSV table with columns, in order:

```text
session_id\tname\tagent_type\trelation\tstatus\ttitle\tworkdir
```

It appends a blank line and `session_id always works as a target. A name is shorter but is not guaranteed unique; when two rows share one, use the session_id.` Name, type, and title are escaped; workdir is emitted directly. Status is only `running` or `idle`, not success/failure/cancellation. H `packages/opencode/src/tool/agent.ts:219-254`.

`agent_send` returns title = requested target, metadata `{target: <resolved-session-id>}`, and exactly these text templates:

```text
Accepted for <resolved-session-id>.
This is a one-way message: this call did not wait for it, and delivery is not guaranteed to have been processed.
If the target is your own subagent, you will be told how it stopped; otherwise, if you need a response, wait for the target to send one back.
```

H `packages/opencode/src/tool/agent.ts:305-317`.

`agent_stop` returns title = target, metadata `{stopped: <count>, failed: <count>}`, and:

```text
Stopped <count> Agent(s): <comma-separated-ids>
A stop was performed on each; that does not mean each was running at the time.
[blank line, Failed:, and - <session-id>: <reason> entries if any]

Their sessions and history are intact and can be resumed with agent_send.
```

H `packages/opencode/src/tool/agent.ts:348-368`. Common typed management failures are returned as tool text with empty metadata, not uniformly thrown exceptions; missing `promptOps` is a separate execution failure. H `packages/opencode/src/tool/agent.ts:101-110,166-168,282-286,302-304,340-350`.

### Identity and reachability

- **Session ID is identity; name is a weak alias.** Every value starting with `ses` is treated as a session ID, not looked up as a name. Existence is checked downstream. Names are case-sensitive exact matches; zero or multiple matches are refused, with candidate IDs on ambiguity. H `packages/opencode/src/agent-management/tree.ts:147-177`; `schema.ts:168-182`.
- Creation rejects names beginning with `ses` and names already used in the root's descendant tree. This is unlocked/best-effort; concurrent creations can still duplicate a name. Use returned session IDs in the probe ledger and all control messages. H `packages/opencode/src/agent-management/lifecycle.ts:103-122`.
- Listing includes **self, parent, direct children, siblings**, not grandchildren or unrelated conversations. It sorts relation in that order, then ascending creation time, then session ID. H `packages/opencode/src/agent-management/tree.ts:115-140`.
- Sending by name searches that neighborhood excluding self. Sending by session ID can address **any existing session**, including another tree; the inbox has no same-tree/neighbor check. Self-send is refused. The recipient executes under its own permissions and stored identity, not the sender's identity. H `packages/opencode/src/agent-management/tree.ts:147-177`; `inbox.ts:82-112`.
- Stopping is narrower: name lookup searches direct children only, and `stop` also requires direct-child ownership even for a supplied session ID. Parent/sibling/grandchild IDs do not bypass that rule. A direct-child stop cascades through its descendants. H `packages/opencode/src/tool/agent.ts:340-347`; `agent-management/lifecycle.ts:401-437`.
- Explicit messages attach sender ID/name/type from execution context. Text renders as `[Agent message from <identity>]`, then `To reply, use agent_send(target="<sender-id>", message="<your reply>").`, blank line, body. Header fields escape backslash, CR, LF, tab and brackets; the body is unchanged. H `packages/opencode/src/tool/agent.ts:287-300`; `agent-management/inbox.ts:33-65`.
The exact inbox header forms are `[Agent message from NAME (TYPE, SESSION_ID)]` when a nonempty name exists, otherwise `[Agent message from TYPE (SESSION_ID)]`. Missing sender type defaults to literal `agent`. The next line is exactly `To reply, use agent_send(target="SESSION_ID", message="<your reply>").`, then a blank line and the unmodified body. H `packages/opencode/src/agent-management/inbox.ts:50-65`.

- An explicit message to a sibling/parent is not a request/response call. If that recipient is itself a child, its automatic run-end report still goes to **its own direct parent**, not necessarily the sender. H `packages/opencode/src/tool/agent.ts:87-96`; `session/prompt.ts:1554-1568,1597-1668`.

### Nested agents, workdirs, and model selection

- Default depth limit is **3**, counting root as 0. At depth >= limit only `agent_list` and `agent_send` remain visible; both spawn and stop are withdrawn. Lifecycle creation checks depth again. Config `subagent_depth: 0` disables spawning. H `packages/opencode/src/tool/agent.ts:392-405`; `agent-management/lifecycle.ts:28,300-305`; `packages/core/src/v1/config/config.ts:84-88`.
- The spawned definition's pinned model wins; otherwise the current calling assistant's provider/model and variant are inherited. A pinned child model clears variant inheritance. The child agent/model is persisted **before** the first asynchronous prompt, so an early message does not bind it to a fallback identity. H `packages/opencode/src/tool/agent.ts:135-159`; `agent-management/lifecycle.ts:317-357`.
- Omitted `cwd` generates `.opencode/worktrees/<...>`: a Git worktree or empty non-Git workspace; Git handling can write `.git/info/exclude`. A supplied nonempty `cwd` is resolved against the instance directory and bypasses generated workspace preparation. Always pass the scratch workspace explicitly for this probe. H `packages/opencode/src/agent-management/workdir.ts:10,27-64,65-122,133-167`.
- `cwd` is **not a sandbox and not a per-session runtime chdir**. Stored workdir metadata has `enforced:false`; file tools/default shell cwd still use the real instance directory. The initial prompt carries the suggested workdir. H `packages/opencode/src/agent-management/schema.ts:29-48`; `lifecycle.ts:325-332,365-377`; `tree.ts:28-43`.
- A newly created child can receive a prompt snapshot naming its parent and up to ten running siblings, permission-gated by the child's `agent_list`. It is not a complete or current roster. H `packages/opencode/src/agent-management/lifecycle.ts:147-214`; `schema.ts:17-27`.

## Delivery, persistence, ordering, and normal Stop

### Idle versus busy delivery

`agent_send` calls inbox `deliver`, which reads the target's stored agent/model/variant and invokes `deliverAsync`. `deliverAsync` forks `prompt` in the target's actual instance directory; failures are logged and published as `session.error`. Its acknowledgement promises **accepted/scheduled only**, explicitly not persistence, processing, eventual processing, or a reply. H `packages/opencode/src/agent-management/inbox.ts:99-140`; `schema.ts:247-257`; `session/prompt.ts:180-215`.

Inside the fork, `prompt` saves a user message and its parts **before** entering/joining the run. An idle runner starts work; a busy runner joins the existing run rather than starting a concurrent model loop. The loop reloads projected message history each iteration. A successful final-boundary race can re-arm the runner when an unconsumed user turn exists. This is “next step/boundary” delivery, not immediate interruption of an already-running provider/tool call. H `packages/opencode/src/session/prompt.ts:1169-1207,1222-1279,1526-1568`; `effect/runner.ts:85-108,145-163`.

There is no native four-tool API field for a delivery mode or a durable per-send FIFO sequence. Concurrent asynchronous admissions should not be asserted to preserve acknowledgement order. Persisted chronology is creation time with ID as same-millisecond tiebreaker; compaction can reorder model-facing history while `latest` separately uses persisted chronology. Number probe messages and reconcile persisted IDs/text instead of relying on return timing. H `packages/opencode/src/session/message-v2.ts:431-471,579-612`.

**Do not substitute the V2 durable inbox described in AGENTS for this tool path.** The native tool calls traced above use `SessionPrompt` and legacy `message`/`part` tables; the schema separately defines V2 `session_input` and sequence-based `session_message`. H `packages/opencode/src/agent-management/schema.ts:196-217`; `packages/core/src/session/sql.ts:65-96,116-164`.

### What survives and what does not

Session parent linkage, agent, model, permission, name/workdir/description/notify metadata and conversation messages are database-backed. Native stop cancels work without deleting them. H `packages/core/src/session/sql.ts:17-96`; `packages/opencode/src/session/session.ts:95-148`; `agent-management/lifecycle.ts:340-357,401-464`.

Live runners and session statuses are in-memory/instance-owned. `SessionStatus.get` defaults missing entries to idle; status maps delete idle entries. `agent_list` maps `busy`/`retry` to running, everything else to idle. A restart is not evidence that previously accepted sends persisted, nor an automatic execution-recovery guarantee. H `packages/opencode/src/session/run-state.ts:39-92`; `session/status.ts:26-46`; `agent-management/status.ts:18-33`.

### Native run-end report to parent

For children with persisted `agentNotify:true`, each loop run has `reportRunEnd` attached through `Effect.onExit`. It:

1. Suppresses a successful report if an unconsumed user turn is about to re-arm work.
2. Classifies cancellation separately and emits settlement without a normal result message.
3. Suppresses reporting while its live-descendant check finds outstanding descendants.
4. Otherwise forks a **synthetic parent user prompt**, preserving the parent's current agent/model/variant. This can wake an idle parent or steer an already-running parent.

H `packages/opencode/src/session/prompt.ts:1554-1568,1570-1668`.

The text is XML-escaped, shaped as:

```text
<agent id="<child-id>" state="completed">
<summary>Agent completed: <description></summary>
<agent_result>
<last visible child text>
</agent_result>
</agent>
```

Failures use state `error`, `Agent failed: <description>`, and `<agent_error>`. The text-part metadata is `{kind:"agent_notification", summary}`. Normal completion uses the final visible text part, not the full child transcript; failures can include bounded excerpts. Full history remains at the child session. H `packages/opencode/src/agent-management/delegation.ts:13-31,55-82,84-163`; `session/prompt.ts:1621-1665`.

`agentNotify:false` is an internal command-subtask exception, not a tool parameter; ordinary `agent` sets true. H `packages/opencode/src/tool/agent.ts:159-167`; `agent-management/schema.ts:88-109`.

### Cancellation is not normal Stop

`agent_stop` cancels deepest levels first, with unbounded concurrency inside each level. Returned ID ordering is therefore not a stable sibling order. It sends exactly one best-effort explicit inbox notice to the caller, attributed to the target child, with `Agent cancelled: ...`, child ID/title, optional descendant count, and resumability text. It does not send notices to parents inside the stop set. An idle target is still reported as stopped. H `packages/opencode/src/agent-management/lifecycle.ts:401-491`; `session/run-state.ts:78-92`.

### Event ordering and quiescence

- A notifying initial spawn publishes `agent.delegation {sessionID,caller,status:"started"}`. Run-end reporting publishes `settled` after the forked parent prompt finishes, or on a no-normal-notice cancellation path. Reused children may emit multiple settlements for one initial start; do not let a numerical debt counter go negative. H `packages/opencode/src/agent-management/lifecycle.ts:229-288`; `session/prompt.ts:1597-1668`; `packages/schema/src/agent-event.ts:8-40`.
- The report is attached to `runLoop` exit; runner completion transitions to idle after that work exits. The report itself is forked, so parent persistence/execution and the child's idle event can interleave. A temporary all-idle tree is not a completion oracle. H `packages/opencode/src/session/prompt.ts:1554-1568,1622-1668`; `effect/runner.ts:85-108`.
- Setting idle emits `session.status` and then `session.idle`; both may be observed. H `packages/opencode/src/session/status.ts:39-46`.
- **FSM's hook does not delay native reporting:** F's event callback uses `void stopController.handleStop(sessionID)` after receiving idle. It can subsequently push a new child prompt for Block. No native report code awaits this verdict. Capture the native report and FSM decision as separate facts, without asserting a universal order between parent execution and completed FSM evaluation. F `opencode-plugin/fsm-plugin.js:939-956,1068-1081,1276-1283`; H `session/prompt.ts:1597-1668`.

## Isolated environment without product changes

### Proposed environment contract (not executed)

Use a fresh **short absolute scratch root** `R`, preferably under the platform temporary directory. Set the process cwd to `R/work`, never either repository. Start with an environment allowlist (`env -i` or equivalent), not `os.environ.copy()` with a few deletions.

```text
HOME=R/home
OPENCODE_TEST_HOME=R/home
XDG_CONFIG_HOME=R/config
XDG_DATA_HOME=R/data
XDG_CACHE_HOME=R/cache
XDG_STATE_HOME=R/state
TMPDIR=R/tmp
OPENCODE_CONFIG_DIR=R/config/opencode
OPENCODE_TEST_MANAGED_CONFIG_DIR=R/managed-empty
OPENCODE_DB=R/data/opencode/probe.db
OPENCODE_DISABLE_PROJECT_CONFIG=1
OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_DISABLE_MODELS_FETCH=1
OPENCODE_DISABLE_DEFAULT_PLUGINS=1
OPENCODE_DISABLE_EXTERNAL_SKILLS=1
OPENCODE_DISABLE_CLAUDE_CODE=1
OPENCODE_DISABLE_LSP_DOWNLOAD=1
OPENCODE_DISABLE_FFF=1
OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true
npm_config_cache=R/npm-cache
npm_config_userconfig=R/npmrc
npm_config_ignore_scripts=true
npm_config_audit=false
npm_config_fund=false
PATH=/usr/bin:/bin:/usr/sbin:/sbin
```

Make the directories and a controlled npmrc during the separately authorized launch setup. H globals derive data/config/cache/state through XDG, but home uses `OPENCODE_TEST_HOME ?? os.homedir()` and tmp is `os.tmpdir()/opencode`; **HOME alone is insufficient**. An absolute `OPENCODE_DB` bypasses channel-dependent DB naming. H `packages/core/src/global.ts:10-51`; `flag/flag.ts:18-77`; `database/database.ts:43-58`; `packages/opencode/src/effect/runtime-flags.ts:17-33`.

Keep `OPENCODE_CONFIG_DIR` equal to `Global.Path.config` (`R/config/opencode`) to deduplicate those two entries. Project disabling does not remove global config or the home `.opencode` discovery path, which is why the home must also be fresh. H `packages/opencode/src/config/paths.ts:23-40`.

Do not inherit cloud/API credentials, provider auth, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, model path/URL overrides, account tokens, proxy variables, plugin metadata overrides, OTEL exporters, or other host overrides. Supply only the intentional probe config via `OPENCODE_CONFIG_CONTENT` or a scratch config file. Set `OPENCODE_PURE=1` for the **native-only** phase; remove it or explicitly set false for the FSM phase. Pure disables **all external plugins**, including the desired FSM plugin. Built-in plugins have the separate `OPENCODE_DISABLE_DEFAULT_PLUGINS` flag. H `packages/opencode/src/plugin/index.ts:170-188`.

**macOS caveat:** the managed-config-directory override does not suppress `readManagedPreferences`, which reads `/Library/Managed Preferences/<username>/ai.opencode.managed.plist` and its system counterpart. A preflight metadata-only existence check found neither plist nor `/Library/Application Support/opencode` on this machine. That is an observation at research time, not a portable isolation guarantee. If present, use an OS-isolated user/container rather than claim these environment variables bypass MDM. H `packages/opencode/src/config/managed.ts:20-66`; `config/config.ts:519-537`.

This is profile/filesystem-path isolation, **not an OS sandbox or network firewall**. Do not claim arbitrary native tools or FSM guard scripts cannot access other paths. Deny unneeded tools in the probe config; enforce stronger isolation separately if required.

### Plugin dependency auto-install and lifecycle safety

`OPENCODE_PURE=1`, `plugin:[]`, and project-config disabling do **not** eliminate config dependency installation. Every discovered config directory gets `ensureGitignore` and a detached `npmSvc.install` adding `@opencode-ai/plugin`; directory commands/agents/plugins are also scanned. H `packages/opencode/src/config/config.ts:310-328,431-477`.

Two distinct controls:

1. **Prevent lifecycle scripts:** HC constructs Arborist with `ignoreScripts:true`. Its npm configuration is loaded from the environment/npmrc. The installed source dependency is Arborist **9.4.0**, matching H's exact dependency; its `reify` uses constructor options for dependency scripts and its rebuild skips preinstall/prepare/install/postinstall under `this.options.ignoreScripts`. H `packages/core/src/npm.ts:80-105`; `npm-config.ts:10-29`; `packages/core/package.json:90-91`. Dependency corroboration, not a binary attestation: `packages/core/node_modules/@npmcli/arborist/package.json:1-3`, `lib/arborist/reify.js:86-110,229-245,1225`, `lib/arborist/rebuild.js:141-162`.
2. **Prevent automatic reification/network/package mutations altogether:** prepare the scratch config directory's dependency state before launch. `Npm.install` skips a non-writable directory; otherwise it reifies if `node_modules` is absent, or if any declared/added dependency name is missing from `package-lock.json`'s root package dependency sets. It checks **names**, not installed contents or versions. Merely making an empty `node_modules` without an appropriate root lock entry is insufficient. H `packages/core/src/npm.ts:140-188`.

Preferred setup is an independently approved prepared dependency tree plus its reviewed manifest/lock, hydrated outside this investigation using `npm ci --ignore-scripts`, containing `@opencode-ai/plugin` in the lock root. Keep native/FSM config dirs clean of arbitrary dependency declarations. If deliberately using only the minimal skip-condition fixture (an empty node_modules plus root lock declaration), label it as a probe fixture, not as evidence that an SDK was installed. Do not modify HC's installer, delete SDK initialization, add environment stubs, or rely on missing network to make initialization “safe.”

Even with reification avoided, `ensureGitignore` may write inside the scratch config directory. Also, instance GET requests can bootstrap config/services. “Passive API” below means no conversation prompts/control mutations, **not zero filesystem effects in the server process**. H `packages/opencode/src/config/config.ts:310-328`; `server/routes/instance/httpapi/middleware/instance-context.ts:25-33`.

### Local mock provider config shape (not implemented or run)

A scratch-only configuration can select the bundled OpenAI-compatible SDK, preventing dynamic package installation for a custom provider SDK:

```json
{
  "enabled_providers": ["hc-probe"],
  "model": "hc-probe/probe",
  "small_model": "hc-probe/probe",
  "snapshot": false,
  "share": "disabled",
  "autoupdate": false,
  "formatter": false,
  "lsp": false,
  "plugin": [],
  "mcp": {},
  "permission": {
    "*": "deny",
    "agent": "allow",
    "agent_list": "allow",
    "agent_send": "allow",
    "agent_stop": "allow"
  },
  "provider": {
    "hc-probe": {
      "name": "HC local probe",
      "npm": "@ai-sdk/openai-compatible",
      "env": [],
      "models": {
        "probe": {
          "name": "Probe",
          "tool_call": true,
          "reasoning": false,
          "limit": {"context": 100000, "output": 10000}
        }
      },
      "options": {
        "apiKey": "local-fixture-key",
        "baseURL": "http://127.0.0.1:<MOCK_PORT>/v1",
        "timeout": 30000,
        "includeUsage": true
      }
    }
  }
}
```

The baseURL placeholder must be replaced with the assigned loopback port. The key above is a dummy, not a credential. Provider restrictions/model selection are public config; options `apiKey`, `baseURL`, and timeout plus model tool/limit fields are accepted. The SDK is bundled; compatible-provider usage is enabled by default. H `packages/core/src/v1/config/config.ts:67-88,111-113`; `config/provider.ts:5-142`; `packages/opencode/src/provider/provider.ts:123,1481-1490,1515-1565,1793-1819,1870-1877`.

There is a pinned **reference**, not authorization to run it: F `experiments/peer_contract/run.py:1174-1197` uses this SDK/config pattern with a local fixture. Its environment setup at `1198-1213` copies the invoking environment and isolates only some XDG paths; do not copy it unchanged for this stricter profile-isolation requirement. Its `stdin=DEVNULL` at `1223-1225` is worth retaining. F `experiments/peer_contract/README.md:53-73` documents no-key abort and prompt_async probes; historical passes there concern older installed binaries, not this binary.

## Passive HTTP observation

Proposed launch command, **not executed**:

```text
/Users/ssyram/bin/opencode serve --hostname 127.0.0.1 --port 0 --mdns=false --print-logs --log-level INFO
```

Use explicit stdin `/dev/null` and scratch-only stdout/stderr files. `serve` has no ambient instance at startup and prints the actual listening URL. Port defaults to zero, hostname defaults to loopback, mDNS defaults false; explicit arguments prevent global network config overriding them. H `packages/opencode/src/cli/cmd/serve.ts:6-26`; `cli/network.ts:6-29,58-81`.

Use a generated scratch server password if desired, passed privately via `OPENCODE_SERVER_PASSWORD`, and Basic authentication (`OPENCODE_SERVER_USERNAME` or default `opencode`). Do not print credentials or put them in captured URLs. The auth middleware accepts Basic and also an auth-token query, but query secrets are unsuitable for an evidence ledger. H `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts:18-66`; `packages/server/src/auth.ts`.

| Read endpoint | Purpose and caveat |
|---|---|
| `GET /global/health` | `{healthy:true,version}`; use to record **actual running** binary version. |
| `GET /global/event` | Global live SSE: `{directory,project?,workspace?,payload}`. Best starting point before instance creation. |
| `GET /event?directory=<encoded-R/work>` | Instance live SSE, filtered by directory/workspace. |
| `GET /session?directory=<encoded-R/work>` | Sessions, latest-updated first; preserve full rows and metadata. |
| `GET /session/<id>?directory=...` | Session info: parent ID, agent/model, metadata, directory. |
| `GET /session/<id>/children?directory=...` | **Direct** children only; recurse to cover nested agents. |
| `GET /session/status?directory=...` | In-memory non-idle status entries, not a durable result table. Missing entry means idle under this service. |
| `GET /session/<id>/message?directory=...` | Persisted conversation with parts. Omitted limit or zero returns all through the handler. |
| `GET /session/<id>/message/<message-id>?directory=...` | Re-read a pinned assistant/user message for stable evidence. |

H `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:45-98`; `groups/event.ts:7-27`; `groups/session.ts:14-35,43-65,116-208`; `handlers/session.ts:79-162`.

Always pass the scratch directory consistently: query `directory` takes precedence over `x-opencode-directory`, then process cwd is the fallback. Instance routes can bootstrap a new instance if pointed at another directory. H `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:20-34`; `middleware/instance-context.ts:25-33`.

SSE frames have event `message`, JSON in `data`, and **no SSE id field** even though JSON payloads have IDs. Instance subscriptions register eagerly, send `server.connected`, and emit heartbeats. Global streaming is a live bus subscription. There is no replay/cursor implementation in these handlers: subscribe first and reconcile snapshots after reconnect; do not rely on Last-Event-ID. H `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts:12-19,25-89`; `handlers/global.ts:34-83`.

Useful JSON event types: `session.created`, `session.updated`, `session.status`, `session.idle`, message/part updates, `session.error`, `agent.delegation`. Prefer saved raw payloads and session/message rereads over inference from display text. The global stream wraps payloads; the instance stream emits `{id,type,properties}` directly.

Not passive: `POST /session`, `/message`, `/prompt_async`, `/agent-message`, `/abort`, DELETE, or config PATCH. For a later authorized driver, `/agent-message` accepts **only `{parts}`**, resolves target identity server-side, returns empty 204 on asynchronous acceptance, and is not an agent-tool sender-identity API. `/prompt_async` has the broader prompt payload. H `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:83-96,337-362`.

## Plugin metadata preloading: not a headless prerequisite

`OPENCODE_PLUGIN_META_FILE` overrides the metadata store path; otherwise it is `Global.Path.state/plugin-meta.json`. A store read failure is treated as an empty store. Entries are keyed by plugin ID and contain source/spec/target, file modification time or npm requested/resolved version, fingerprint, first/last/change times, load count, and optional themes. File fingerprints are `target|mtime`, **not content hashes**. Preloading a matching entry affects `first`/`same`/`updated` classification; every touch still increments load count and updates last time. It does not authorize, import, disable, or install a plugin. H `packages/opencode/src/plugin/meta.ts:38-47,78-139,142-165`.

The **TUI** loader calls `PluginMeta.touchMany` after resolving ready entries, before creating TUI plugin entries. The **server** loader used by `serve` resolves the module's ID and calls `server(input, options)` directly; that path does not call PluginMeta. Therefore no plugin-meta seed is needed for this recommended headless FSM launch. Preloading metadata cannot prevent the config dependency installation described above, and it is not proof of successful server-hook registration. Path-based V1 plugins must export an ID; F does (`fsm.opencode`). H `packages/opencode/src/plugin/tui/runtime.ts:775-807`; `plugin/index.ts:114-126`; `plugin/shared.ts:306-324`; F `opencode-plugin/fsm-plugin.js:1149-1155`.

## Pinned FSM integration prerequisites

1. **Exact artifact and compatible binaries.** Use the JS bytes from F's pinned object, not its current worktree, plus explicitly identified `mcp-server-fsm`, `mcp-server-fsm-client`, and `mcp-server-fsm-hook` binaries. Record versions/hashes in a later authorized preflight; none were built or executed here. F plugin is one dependency-free JS file using Bun/node built-ins. F `opencode-plugin/fsm-plugin.js:3-21`; `docs/design/opencode-support/architecture.md:242-266`.
2. **A separately running isolated daemon.** Set the same short `FSM_DATA_DIR=R/fsm` in HC, plugin-spawned hook, MCP client, and daemon. Start `mcp-server-fsm serve --data-dir R/fsm` as an owned foreground child; do not install/use a production service manager. Hooks never spawn/restart the daemon. Missing daemon may block tools or soft-degrade Stop rather than prove integration. F `crates/server/src/main.rs:54-65`; `crates/hook/src/main.rs:1460-1519`.
3. **Real reachable HC HTTP server.** Use `serve` and the actual assigned URL. Plugin `serverUrl` is propagated as `OPENCODE_SERVER_URL` on every hook subprocess, which inherits HC's environment. Do not substitute a nominal URL with no TCP listener. H `packages/opencode/src/plugin/index.ts:150-165`; F `opencode-plugin/fsm-plugin.js:545-570,1154-1173`.
4. **Enable only the intended external plugin.** For this phase `OPENCODE_PURE` must be false/unset; keep fresh config and default plugins disabled. Explicitly configure the pinned local plugin path plus options, not auto-discovery. H `packages/opencode/src/plugin/index.ts:170-188`; F `docs/design/opencode-support/architecture.md:252-266`.

```json
{
  "mcp": {
    "fsm": {
      "type": "local",
      "command": ["/scratch/bin/mcp-server-fsm-client"],
      "enabled": true,
      "timeout": 900000
    }
  },
  "plugin": [["/scratch/pinned/fsm-plugin.js", {
    "hookBin": "/scratch/bin/mcp-server-fsm-hook",
    "fsmServerName": "fsm",
    "hookTimeoutSeconds": 900
  }]]
}
```

This is a merge fragment for the separate FSM configuration, not a second product config to install globally. MCP timeout is milliseconds (default only 5000); plugin hook timeout is seconds, default/minimum **900**. `FSM_OPENCODE_HOOK_TIMEOUT_SECONDS` takes precedence over plugin options, so do not inherit it inadvertently. Longer/shorter test deadlines must respect this real product timeout rather than patching it. H `packages/core/src/v1/config/mcp.ts:6-27`; F `opencode-plugin/fsm-plugin.js:112-219,1154-1167`.

5. **Tools and actor identity.** `fsmServerName:"fsm"` means the plugin recognizes host tool names with `fsm_`, strips exactly that prefix for identity bridging, and routes other tools through `check-permission`. Native `agent` becomes FSM `Agent`; the other native management names pass through unchanged. Configure any fixture permissions accordingly; do not match tools using an unbounded suffix such as `endswith("agent")`. F `opencode-plugin/fsm-plugin.js:24-49,1295-1343`.
6. **Root and nested mapping.** Plugin maps root HC session ID to FSM `session_id`; root actor is `agent_id:"main"`; every descendant uses its own HC session ID as `agent_id` under that root. Parent resolution uses event-sourced `parentMap`, SDK lookup fallback, and a 16-link bound. It caches results. `session.created` initiates best-effort `subagent-start`; root acquisition happens via hooks. Internal `fsm-gate` sessions and their known descendants bypass hooks. F `opencode-plugin/fsm-plugin.js:408-430,1092-1144,1240-1274`.
7. **No per-session hook cwd.** `agentCwd()` is `process.cwd()`, carried on every hook payload. This reinforces the need to launch HC itself in the scratch workdir and pass that same explicit `cwd` to native agents. F `opencode-plugin/fsm-plugin.js:1193-1207`.
8. **Stop semantics.** Idle is only a signal. The plugin pins the latest assistant message, polls for error or finite completion, skips errored/stale/unavailable/unsettled turns, deduplicates terminal assistant IDs, and coalesces idle arriving during active evaluation. Normal settled roots invoke hook `stop`; descendants invoke `subagent-stop`. A Block is delivered through parts-only `client.session.promptAsync`; the event callback cannot veto idle. Permission-check transport failure is fail-closed; plugin Stop transport failure is observable soft Allow, so an Allow alone does not prove a successful evaluator. F `opencode-plugin/fsm-plugin.js:573-595,631-661,666-775,864-980,1002-1059,1276-1283`.

### Hook trace boundaries

Every production hook call uses `[hookBin, subcommand, "--emit", "json", "--agent-cli", "opencode"]`, with explicit JSON stdin. Relevant subcommands are `subagent-start` on child creation; `identity-acquire` for FSM tools; `check-permission` for non-FSM tools; root `stop` or descendant `subagent-stop` after normal assistant settlement; and `gate-release` after a question answer. `session-start` is deliberately not spawned during plugin initialization. F `opencode-plugin/fsm-plugin.js:545-628,1050-1059,1121-1137,1182-1195,1295-1354`.

Hook exit 0/2 is authoritative Allow/Block; decoded JSON can add validated reason, no-progress count, and redacted diagnostics. Other exit codes are transport errors. `defaultSpawn` collects stdout and drains stderr for subprocess completion; this is not an append-only raw-hook audit archive. Plugin diagnostics use `client.app.log` with service `fsm.opencode`; observe those logs and Stop snapshots alongside daemon actor history. A complete raw hook invocation/result ledger would need a separately authorized harness/process capture, not an assumption that metadata or latest snapshots preserve it. F `opencode-plugin/fsm-plugin.js:57-110,466-570,787-815`.

No FSM definitions, model-backed judgments, providers, or fixture workflows were launched in this research. A subsequent integration probe must explicitly decide whether it is testing registration/transport only or real FSM judgments; the latter may invoke additional local mock requests and must not fall back to configured paid providers.

## Proposed trace ledger for the authorized probe

Keep all evidence outside package/references, under `R/artifacts`, with raw append-only event capture plus periodic immutable snapshots. This is a launch recommendation, **not a claim that these traces were collected**.

| Trace | Required fields / join keys | Why |
|---|---|---|
| Run manifest | Binary absolute/real paths, supplied and observed version, hashes, H/F revisions, cwd, sanitized env/config, actual HC/mock ports, start/end timestamps and owned PIDs | Distinguish source claims from the running artifact and prevent profile leakage. |
| Model request/response capture | Local request sequence, model ID, request tools/schema, tool call ID/name/arguments, response chunks, completion/error, hold/release marker | Establish actual offered tools and busy-boundary causality. No credentials. |
| Raw SSE | Local receipt sequence plus monotonic time, whole JSON event, JSON event ID, directory, session ID, message/part IDs, delegation caller/status | Preserve observable order without pretending receipt order is a global transaction order. |
| Session tree | Each full `Session.Info`, parent ID, agent/model, metadata name/workdir/description/notify, actual directory | Resolve sibling/nested routing and stable identities. Recurse children. |
| Tool transcript | Actor session ID + assistant message ID + part/call ID + exact input + output + metadata + state/timestamps | Verify agent creation/send/stop from the actual tool, not narration. |
| Message admission | Probe body sequence + sender ID + resolved target ID + persisted user message/parts | Separate accepted, persisted, consumed, and replied milestones. |
| Normal parent report | Child ID embedded in XML, parent user message ID, synthetic flag and `agent_notification` metadata, later parent assistant | Prove native run-end handoff separately from explicit messages. |
| Cancellation | Requested direct child, recorded subtree, tool stopped/failed counts, single caller notice, retained history, later resume message | Distinguish stop invocation from previously-running status. |
| FSM actor/decision | HC root ID + FSM session_id + actor agent_id; daemon transition/release/history evidence; hook outcome and non-secret diagnostic category | Prevent main/child evidence from substituting for each other. |
| FSM Stop snapshots | Poll/copy `FSM_DATA_DIR/opencode-stop-status/<sha256(HC-session-id)>.json` with capture timestamp; preserve every observed change | Snapshot retains current run/latest verdict, not every decision. |

The snapshot publisher writes atomically through a per-session queue, outside the Stop decision await graph. It records `schema_version`, session ID, running/timing and latest result/skip; repeated decisions overwrite previous ones. Snapshot I/O failure does not decide the gate. F `opencode-plugin/fsm-plugin.js:260-404,915-974`. F `experiments/full_e2e/README.md:129-135` explicitly states there is **no durable Stop audit ledger**; polling may miss intermediate decisions. An external append-only copy is useful but cannot retroactively prove decisions missed between polls.

A future deterministic local mock should exercise these scenarios with bounded, explicit checkpoints (proposal only):

- Spawn two direct children with distinct names, explicit scratch cwd; record returned IDs and list TSV.
- Hold one provider turn; send a numbered correction while busy; verify persisted receipt precedes its next model step, without expecting the current held call to change.
- Let a child become idle; send numbered follow-up; verify the same session/agent/model resumes and native parent reporting recurs.
- Child sends sibling and parent messages; observe explicit replies and keep their routing separate from automatic direct-parent reports.
- Spawn one grandchild; verify neighborhood visibility, ID versus name reachability, and root stop of a direct-child subtree. At configured depth, record tool withdrawal.
- Normal child completion: capture native parent report, child idle signals, parent execution, and delegation settlement as distinct milestones. In FSM phase also capture delayed Block/Allow and any child continuation; do not conflate them.
- Stop a running subtree and an already-idle direct child; assert retained sessions/history, one caller cancellation notice, and later `agent_send` resumability. Do not assert every “stopped” ID was busy.

For completion, reconcile the expected final persisted messages and tool outputs, outstanding delegation IDs (idempotent settlement), in-memory status, and mock in-flight requests. For FSM, additionally require actor-specific terminal/release evidence and the relevant observed verdict; a transient all-idle tree, a marker file, a parent report, or a latest Allow snapshot alone is insufficient. F's existing e2e ownership documentation similarly joins child host identity, actor transitions/releases, and structured tool traces rather than trusting shared files alone: `experiments/full_e2e/README.md:153-170`.

## Validation performed and remaining limits

**Performed:** read-only pinned-source tracing; H HEAD verification; F commit/type and tree verification; binary symlink metadata inspection; matching installed Arborist source inspection; metadata-only managed-preference absence check; H initial/final status check; empty staged-file checks in H and pi. No secret-bearing configuration, auth files, or untracked `packages/tui/tmux` contents were read.

**Not performed:** binary `--version`, HTTP requests, provider calls, mock/provider implementation, package install, dependency hydration, daemon startup, test execution, build/typecheck, or independent review. The local config and launch plan are source-backed proposals, not runtime-validated artifacts. Some exploratory path/object lookups failed while locating files; no product check/test failed because none was run.

**Residual risks:** binary/source correspondence is not attested; actual provider wire and race timing require the authorized probe; environment isolation is not a sandbox; macOS MDM can bypass ordinary config isolation if present; pure mode does not prevent config npm activity; async acceptance is weaker than durable delivery; statuses/SSE are not restart recovery; native parent completion notification is not synchronized with FSM Stop; FSM snapshots are overwrite-only and polling is incomplete.
