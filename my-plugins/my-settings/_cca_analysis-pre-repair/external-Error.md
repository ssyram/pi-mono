# external: error

`console.error(...data)` — Node console writer. Used at extension.ts:27 and extension.ts:36 as the plugin's safe-diagnostic channel, both inside `try { ... } catch {}` wrappers (bind's catch at extension.ts:27, mySettings' catch at extension.ts:36).

- Pre: none (console object provided by Node host; even a replaced/throwing console.error is contained by the surrounding `try{}catch{}` at both call sites).
- Post: writes to stderr (or host diagnostic sink); returns undefined; does not throw under normal host operation.
- Failure relevance: this is the owner-sanctioned "safe Pi diagnostic" path — if `console.error` itself throws, the enclosing empty catch swallows it, so `bind` / `mySettings` still do not propagate. Host process death (stderr EPIPE escalation, OOM) is catastrophic-host territory, outside the per-function JS contract.
