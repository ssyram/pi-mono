# Round 002 Counter

1. 成立并已修：契约改为内容 buffer 单次 write，允许原生 cursor-only write；terminal I/O 错误保持原语义。
2. 成立并已修：删除无效参数和分支，`finishRun` 单点负责 deferred alignment。
3. 成立并补证：active resize 即时采样 `2J=0/3J=0`；完成后原生对齐一次，符合静态等价。
4. 成立并补证：active direct shutdown 的 JSONL 只有 Pi 已持久化 entries；原生/插件 resume capture `cmp=0`。
5. 未构成新 finding：22 tests、静态扫描和真实两轮 agent run 提供对应证据。
