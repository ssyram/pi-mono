# simplify-compact 候选补丁稳健性审查（只读）

## 审查范围与方法

已逐份审阅：

- `docs/simplify-compact-20260911/README.md`
- `docs/simplify-compact-20260911/design.md`
- `docs/simplify-compact-20260911/code-plan.md`
- `docs/simplify-compact-20260911/correctness.md`
- `docs/simplify-compact-20260911/verification.md`
- `docs/simplify-compact-20260911/candidate.patch`

并核对当前源级链路：

- facade：`hooks/custom-compaction.ts`、`hooks/prepare-compaction-request.ts`
- 新轮文件清单：`hooks/compaction-file-operations.ts`
- state 边界：`hooks/compaction-reference-state.ts`
- annotation：`hooks/annotate-compaction-references.ts`
- codec：`hooks/compaction-reference-codec.ts`
- 批准契约：`docs/compact-user-refs/APPROVED-SCOPE.md`
- 现有相关 tests（只读）：state、codec、annotation、prepare request。

没有修改、应用或生成任何项目文件；没有读取另一份审查报告；没有 reload 模板、调用 provider、真实 compact、运行全仓 write check 或执行真实运行时 wiring。唯一写入是本报告的指定宿主路径。

## 已验证的设计链与契约

### Facade / state / codec / annotate 的跨边界结论

候选只改四个生产路径，且 `candidate.patch` 的 `git apply --check` 成功：

```text
55  0  hooks/format-compaction-path-list.ts
8   2  hooks/compaction-file-operations.ts
26  0  hooks/compact-compaction-file-suffix.ts
5   1  hooks/prepare-compaction-request.ts
```

补丁形状与当前链路一致：

1. B (`formatCompactionFileOperations`) 仍由既有 extractor 先形成 `modified = edited ∪ written`、`readOnly = read − modified`，再按既有顺序排序、分别放入 `<read-files>` 与 `<modified-files>`。候选仅替换两个 `join("\n")` 的表内渲染。
2. D (`prepareCompactionRequest`) 在 `referencesEnabled && preparation.previousSummary` 时创建浅层 `displayState`；`serializeCompactionReferenceConversation(messages, state, ...)`、reference codec、`expandCompactionReferences(state, draft)` 以及 `finalizeSummary()` 闭包仍使用原 `state`。
3. 因此 sources、`summarySourceCount`、`userOrdinals`、引用编号和 raw source text 不被候选改写或重新编号。`renderCompactionReferenceSummary(displayState)` 中仅模型可见的 `fileSuffix` 可能变短。
4. `finalizeSummary()` 仍只先对原 state 做一次 expand/decode，空正文仍返回 `""`，非空正文仍只追加本轮 B snapshot 一次。候选不把旧 suffix 写回 state 或持久摘要。
5. `custom-compaction.ts` 不在补丁中：provider/auth/UI/error fallback、模型调用次数、`maxTokens = floor(0.8 * reserveTokens)` 和 facade 的空输出门禁均没有改动。
6. A/C 生成的 brace/comma 表示不含 `@` 引用协议的新语法；annotation 仍只对普通文本执行现有 pipe escape，codec 仍只解析 `@...`。没有新标签进入 codec，没有新增 source class、input/output estimate、cap、retry、provider call、fallback、日志或输出拒绝门禁。

这符合 `APPROVED-SCOPE.md` 的关键要求：terminal file suffix 不索引、保持在原 prompt 位置；raw sources 保留；一次 expand/decode 后只 append 一次；无新估算/截断/retry/fallback/provider 行为；无 source 时 ordinary prompt 保持原分支。现有 `prepare-compaction-request` 测试也已覆盖 OFF prompt 字节一致、一次追加、一次展开、literal pipe、Unicode/CRLF 和 provider guard；本候选尚未实现，故这些不是候选集成测试结果。

## WP/SP、循环与终止性核查

### A：`formatCompactionPathList`

在文档给出的充分前置条件（调用方传入普通内部路径数组且 baseline `join` 可完成）下，候选逻辑满足以下局部证明：

- gate 要求每个 entry 为单 `/` 分隔、至少两个 component，且 component 非空、非 `.`/`..`，只含 `[A-Za-z0-9._@%+=~-]`。故被分组的 `parent/{leaf,...}` 无 brace/comma/newline 歧义，可逐项、按原顺序展开。
- 外循环每轮处理一个最大连续同 parent run。`start` 严格增至 `end`，变元 `n - start` 单调下降且非负；内循环 `end` 严格增加，变元 `n - end` 单调下降。因此两循环终止。
- 归纳不变量可维持：已输出 lines 精确展开为原前缀；每个已处理 run 不跨越中间 path；列表及 entries 未被写入。singleton 原样保留，多项 run 仅在局部严格更短时分组。
- 最后的 `compacted.length < baseline.length ? compacted : baseline` 保证总字符串不增长；局部 group 即使短、但总表不短时，仍回退到逐字 baseline。

### C：`compactCompactionFileSuffix`

C 是固定两次的 `read-files`、`modified-files` 循环，不搜索 summary body：

- 每节只接受精确 `\n\n<tag>\n` 开头、非空内容和 `\n</tag>`；`offset !== suffix.length`、零节、空节、未知/重复/倒序 tag、额外尾部、关闭标签后空白均原串返回。
- 每步 `offset` 前进到 close 后；迭代次数最多 2，故终止。
- C 只接受 `state.fileSuffix` 这个调用边界，在有效完整 suffix 内把每节 `split("\n")` 交给 A。候选实际按节保留 A 无收益或不安全的原文本；只要另一节使**整体** suffix 严格变短，C 仍返回混合结果。此行为符合 `correctness.md` 的分节 SP，但与 `design.md`/`verification.md` 的整体回退文字不一致；最小反例见 R4。
- C 只改显示副本，不会重排节、去重、跨节移动或改写标签。

## 无落盘内存验证

以候选 A/C 的同构 JavaScript 实现执行断言，所有断言成功。覆盖：

- 可缩短的长深同父路径；
- 重复 path 和非相邻同 parent 保持 baseline；
- Unicode、CRLF、NUL、空格、tab、孤立 high surrogate、brace、comma、UNC/backslash、`C:`、`.`、`..`、重复 slash、尾随 slash 任一出现时，整表逐字 baseline；
- 有效 read+modified suffix 的两个 section 都保持 tag/顺序且缩短；
- 正文前缀、空节、尾随 newline、重复 tag、倒序 tag、CRLF、已含 brace/comma 的旧内容均逐字返回。

运行输出：

```text
in-memory candidate-equivalent assertions: 25 passed; syntax-boundary provenance counterexample reproduced
```

注：输出中的 `25` 是脚本的人工标签，未以计数器自动计数；应以“所有实际 `assert` 成功”而非该数字作为证据。该验证是候选逻辑的内存复刻，不是未应用 TypeScript 源码的集成/类型/运行时证明。

## 可复现反例与审查发现

### R1 — `fileSuffix` 不是来源认证（明确残余边界；不是凭空宣称的实现失败）

当前 `summaryBodyEnd()` 以语法寻找最右侧可闭合 terminal tag，而不追踪 OMP 生成来源。如下旧摘要将其最后的嵌套/畸形段分离为 `fileSuffix`：

```text
prose

<modified-files>
outer-text

<modified-files>
long/parent/alpha.ts
long/parent/beta.ts
</modified-files>
```

使用当前 state 函数后：

```text
fileSuffix === "\n\n<modified-files>\nlong/parent/alpha.ts\nlong/parent/beta.ts\n</modified-files>"
```

候选 C 随后产生：

```text
\n\n<modified-files>\nlong/parent/{alpha.ts,beta.ts}\n</modified-files>
```

这不是路径丢失或 source map 改写：可逆展开仍成立，state 会把前部保留为 body source，D 也不持久化 compacted display suffix。它却证明“已由 state 语法切分”**不能证明**“该文本由 OMP 生成”。所以：

- 若产品契约是“只压缩可从格式上识别的 terminal suffix”，候选与 design/correctness 的明确限制一致，R1 是已披露的残余风险。
- 若产品契约实际要求“绝不改写用户/模型伪造或畸形 XML 中的任何文本”，候选及现有 state 都不足：需要来源认证/metadata，属于 `APPROVED-SCOPE` 当前禁止的额外状态/机制，不能把它误报为本小补丁已解决。

此点正是 `state.fileSuffix` 既有**语法边界**与**来源认证**必须区分的证据缺口。

### R2 — catch 不是任意调用边界的全覆盖（明确未覆盖项）

A 在 `try` 之前计算：

```ts
const baseline = paths.join("\n");
```

因此，一个运行时 Proxy 或 getter 使 `join` 的 property access/执行抛错时，异常不会由 A 的 catch 回退。例如概念输入：

```ts
new Proxy(["long/parent/a", "long/parent/b"], {
  get(target, key, receiver) {
    if (key === "join") throw new Error("baseline failure");
    return Reflect.get(target, key, receiver);
  },
})
```

会在进入 catch 前抛出。OOM、VM termination、ESM module-load/import failure 同样不在此函数 catch 覆盖范围。候选文档已正确限定为“已有 normal array 且 join 可完成”的充分前置条件，并明确排除了 OOM/模块加载；因此这不是对已声明 P→Q 的反例。必须避免把 `catch { return baseline }` 叙述成插件永不抛错、或把只读 TypeScript 类型误认为运行时普通 array 认证。

### R3 — 可逆性只适用于安全 path-list 域，不适用于任意 raw suffix 文本

A 的 reversible brace expansion 只在整表每一个字符串通过安全 component gate 后主张。比如 Unicode、CRLF、NUL、反斜杠/UNC、空白、brace/comma、dot segment 或空 component 出现时，A 返回该**节**原 `join("\n")`；它不、也不能，恢复旧格式中一个文件 path 本身含换行的语义。C 可在另一节缩短足够多时返回这个原样节与已压缩节的混合 suffix（见 R4）；所以“某一节不安全”并不等价于“整个 suffix 必然逐字回退”。设计关于 A 的受限可逆性仍成立，但 C 的整体回退文案需要澄清。

### R4 — C 的混合节行为违反/至少不满足设计与验证的整体回退措辞

最小完整 `previousSummary`：

```text
S

<read-files>
unsafe/é
</read-files>

<modified-files>
very/long/parent/alpha-file.ts
very/long/parent/beta-file.ts
</modified-files>
```

用**当前、未变更**的 `buildCompactionReferenceState([], previousSummary)`，语法切分的原 state 是：

```text
body === "S"
fileSuffix === "\n\n<read-files>\nunsafe/é\n</read-files>\n\n<modified-files>\nvery/long/parent/alpha-file.ts\nvery/long/parent/beta-file.ts\n</modified-files>"
```

注意：`body`/`fileSuffix` 的上述切分是既有 `summaryBodyEnd()` 的 terminal **识别语法**；它早于且独立于候选 C。候选新增的变换只发生在这个 `fileSuffix` display copy 中。

按候选 C 的实际代码：

1. read section 被 `content.split("\n")` 送入 A。`unsafe/é` 含 Unicode，A 返回该 read section 的逐字 baseline。
2. modified section 的两条 ASCII safe path 被 A 缩为 `very/long/parent/{alpha-file.ts,beta-file.ts}`。
3. C 没有检查任一 A 调用是否“无收益”；它只比较完整重组后的 `compacted.length < suffix.length`。本例整体缩短 15 个 UTF-16 code units，因此返回：

```text
\n\n<read-files>
unsafe/é
</read-files>

<modified-files>
very/long/parent/{alpha-file.ts,beta-file.ts}
</modified-files>
```

这不会丢 path、不会改 read/modified 分类、不会影响原 state/source/codec，也不产生新 provider gate。但文档不能同时主张以下两种语义：

- `design.md:27`：C 在“`A 无收益或异常`”时“逐字返回输入”；
- `verification.md:34`：CRLF / Unicode / whitespace / brace-comma 路径使“对应 A 原样，因而 C 不作有收益改写”；
- `correctness.md:61-63`：A 无收益时保留**该节**，只要总长度有收益即可返回同 tag/顺序的较短 suffix。

候选实现与第三项一致，而不满足前两项按自然的整体回退读法。此为设计先行/验证计划与实现的文档契约不一致，且现有 verification matrix 缺失 mixed read/modified test。修订前，不应报告“任一 unsafe section 使 C 整体原样返回”；应明确选择“per-section fallback + overall shortening”（候选实际行为）或修改实现为任一 section 的 A 无收益即返回原 suffix。

## 未发现的专项破坏（限于静态与内存证据）

以下结论均是“在本次未应用补丁的静态 diff 和内存检查中未发现”，不是运行时通过声明：

- 未发现 read/modified 分类变化、跨表混合、去重语义变化、path 漏失或排序/非相邻 run 重排。
- 未发现普通 raw source、source ordinal、source document、`summarySourceCount` 或 `userOrdinals` 被改写/重编号。
- 未发现 C 接受正文前缀、嵌入 close 后残余、重复/倒序 tag、空节、关闭后多余尾部；这些都回退原串。
- 未发现新 brace 格式被 codec 作为 reference；codec 的 `@!…@` 语法及 one-pass non-rescan 仍由原 `state` 执行。
- 未发现 provider 重试、额外调用、estimate/cap/truncation、输出 size gate 或新的 fallback；`custom-compaction.ts` 未在补丁内。

## 证据未覆盖与后续实施门槛

本轮没有、也不应声称完成：

- 未应用 patch，故未做 TypeScript load/typecheck、source-level test、formatter/linter、真实 facade 执行或实际 compact。
- 未验证真实模型是否理解 brace 表示、token/latency/caching 改善，或模型是否会复制显示态 suffix；设计也不应对此作保证。
- 未覆盖 OOM、process termination、module loading、任意 Proxy/getter、副作用数组和未来 Pi API 行为。
- 现有 tests 虽覆盖 state/codec/annotation/facade 的原有合同，尚无候选 A/C/D 的源级测试。实施后必须按 `verification.md` 增加 focused source-level tests，并在协调工作区中执行规定门禁；不得将本次内存复刻当作替代。
- 工作区本来就有 staged files（见下），本审查未 stage/unstage 任一文件，也未影响它们。

## 命令与工作区证据

成功运行（只读）：

```sh
git apply --check my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch
git apply --numstat --check my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch
node --input-type=module <<'NODE' ... candidate-equivalent assertions ... NODE
git diff --cached --name-only
```

`git apply --check` 无错误；numstat 如上。`git diff --cached --name-only` 显示审查开始前/期间已存在的 staged paths：

```text
my-plugins/impression
my-plugins/oh-my-pi-v2/README.md
my-plugins/oh-my-pi-v2/agents/atlas.md
my-plugins/oh-my-pi-v2/agents/hephaestus.md
my-plugins/oh-my-pi-v2/agents/librarian.md
my-plugins/oh-my-pi-v2/config.ts
my-plugins/oh-my-pi-v2/hooks/sisyphus-prompt-core.ts
my-plugins/oh-my-pi-v2/hooks/sisyphus-prompt-execution.ts
my-plugins/oh-my-pi-v2/hooks/sisyphus-prompt.ts
```

这些不属于 candidate 的四个生产 path，本审查未修改项目文件，亦未尝试清除别人的暂存区。

## 审查结论

候选的 A/B/C/D 分层、循环变元、总长度回退和 facade 隔离在其可证明的局部域内成立，且补丁可干净应用；静态检查未见其引入 source/codec/provider/output-gate 破坏。可是 R4 表明 C 的已写 design/verification 合同与候选代码/`correctness.md` 不一致，因此当前不能把该候选称为完整的“设计先行且验证闭合”方案。

发布/实施前不得把结论扩大为“任何旧摘要都只会压缩 OMP 生成路径”、“任一不安全 section 均使整个 C 原样返回”或“catch 覆盖所有错误”。R1、R2 和 R4 必须保留：先澄清/修订 mixed-section 合同并加源级测试；若 R1 的 provenance 边界不被产品接受，则还必须先改变 approved scope 和 state provenance 设计，而非直接应用这份四文件补丁。
