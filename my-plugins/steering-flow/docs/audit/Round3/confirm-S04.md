# S-04 Confirmation: LLM args unsanitized in child process argv

## Verdict: REJECTED-misreading

## Reasoning

The finding claims that unsanitized YAML-defined args allow injection via shell metacharacters in child process spawn calls. This mischaracterizes the actual attack surface. In `engine.ts`, `runCondition()` calls `spawn(cmd, argv, { cwd, env: process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] })` with **no `shell` option**, which defaults to `shell: false`. The source code itself contains a comment stating the process is "spawned WITHOUT a shell (no injection surface)." With `shell: false`, Node.js passes each argv element directly to the OS `execvp` syscall — shell metacharacters like `;`, `|`, `&&`, `$(...)`, and backticks are treated as literal characters, not interpreted. The classical shell injection scenario described in the finding is not reachable.

There is a **separate, real concern** not captured by this finding: LLM-controlled `namedArgs` values are interpolated unsanitized into both the `cmd` string (which determines which binary executes) and `configArgs` elements via `interpolatePlaceholders()`. If a YAML flow defines `cmd: "${user_input}"` or `args: ["--file=${user_input}"]`, the LLM can influence which binary is resolved or what arguments the target program receives. This is argument injection into the target program, not shell injection — a meaningfully different vulnerability class with different exploitation requirements (it depends entirely on what the target binary does with its argv). The finding as written specifically claims shell metacharacter injection, which is incorrect given `shell: false`.

Rejecting because the core mechanism described (shell metacharacter injection via unsanitized args in spawn) does not apply when `shell: false` is in effect. The interpolation-based argument injection that does exist is a distinct finding with different severity characteristics and would need to be filed separately with accurate framing.
