# Round 003 — Independent Review Record

## Original trigger

同一`subagent-async` live widget的`2m13s`与`9m55s`同时可见。源码证明逻辑tree只有一个same-key widget；旧版本来自Pi full-root CRLF scroll留下的physical row。

## Pre-implementation ruling

Oracle/fresh review否决dynamic viewportTop，要求fixed bounded ownership、top history region、exact-height volatile rows、full-frame handoff和C<2 fail-open。复审为0 blocker / 0 major，implementation gate打开。

## Implementation deviations reviewed

### DSR entry

实际Pi是inline TUI，screen可含shell rows。实现必须查询physical cursor才能把native logical row映射到absolute screen。DSR发生在paint gate内，保留邻接input并处理late response。

### Dynamic protected spill

固定H行reservoir在真实long smoke造成hidden finalized gap。修订为按实际live capacity保留finalized tail；任何会被裁掉的finalized前缀先进入history。该修订恢复full visible continuity和seamless handoff。

### Stop ownership

Pi stop直接写terminal，故managed epoch临时own `stop`以同步native recovery。resume后不重新managed。

## Evidence

- 48 automated tests / 10 suites。
- global Pi 0.83.0 startup与tmux deterministic run。
- 80 final rows each once；stale progress 0；`2J=0`；warning 0；中文editor保留。
- xterm raw replay duplicate/missing/stale均0。

## Implementation fresh review

实现后fresh review追加检查DSR framing、async lifecycle、post-write transaction、committed reorder、partial write、stop race与reentrancy。修复并新增tests后，窄范围review返回0 blocker / 0 major / 0 minor；最后一个installation-throw状态缺口也已以atomic method rollback和coordinator fallback关闭。

## Current conclusion

实现对normal managed path的source-order history、volatile non-leakage、Editor priority和long-run seamless handoff有证据。仍不能批准“Apple Terminal IME crash fixed”或“all terminals production complete”；这些需要direct terminal matrix。
