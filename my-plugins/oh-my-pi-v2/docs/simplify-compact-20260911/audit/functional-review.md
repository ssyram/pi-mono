# 独立功能正确性审查：`simplify-compact-20260911`

**结论：BLOCK / 不应按当前 `candidate.patch` 合入。**

本次为只读审查：未应用补丁、未修改项目文件、未调用 provider、未运行真实 compaction，也未读取其他审查报告。候选补丁可以干净应用，且其局部 A/C/D 逻辑在所述分支中大体保持引用协议；但 B 的接入把“当前轮生成、最终持久化的 suffix”从原始 newline 路径表改为 brace 表示。这不是仅 renderer 的显示投影，违反已批准的“保存 existing file suffix / 一次展开后追加 file operations 一次”边界和本方案自己的设计范围。一个不依赖模型或 provider 的 OFF 反例即可触发。

## 审阅材料与边界

已完整读取：

- `docs/simplify-compact-20260911/README.md`
- `docs/simplify-compact-20260911/code-plan.md`
- `docs/simplify-compact-20260911/design.md`
- `docs/simplify-compact-20260911/correctness.md`
- `docs/simplify-compact-20260911/verification.md`
- `docs/simplify-compact-20260911/candidate.patch`
- `docs/compact-user-refs/APPROVED-SCOPE.md`
- 当前调用链源码：`hooks/compaction-file-operations.ts`、`prepare-compaction-request.ts`、`compaction-reference-state.ts`、`annotate-compaction-references.ts`、`compaction-reference-codec.ts`、`compaction-prompts.ts`、`custom-compaction.ts`
- 现有 facade/协议测试：`prepare-compaction-request*.test.ts`、`compaction-reference-*.test.ts`、`custom-compaction.test.ts`，及其 fixtures/provider guard。

未把方案文档中的候选纯函数或计划中的未来测试称为生产集成测试。未从“字符数更短”推出 provider token、缓存成本、延迟、模型输出长度或模型语义等价。

## 补丁形状、可应用性与物理统计

`candidate.patch` 仅触及四个生产路径，路径、类别与 hunk 顺序有效：

1. 新增 `hooks/format-compaction-path-list.ts`：`+55/-0`
2. 修改 `hooks/compaction-file-operations.ts`：`+8/-2`
3. 新增 `hooks/compact-compaction-file-suffix.ts`：`+26/-0`
4. 修改 `hooks/prepare-compaction-request.ts`：`+5/-1`

`git apply --check` 成功；`git apply --numstat --check` 成功，合计 **`+94/-3`**。patch 物理记录为 150 行。新增模块分别为 55 和 26 物理行；修改后的既有目标按补丁计为 68 和 105 行，均未触及 200 LOC 限制。两条新增文件 header 中有重复的 `--- /dev/null` 行，但当前 `git apply --check` 接受它；它不是本报告的功能阻塞项。

B 保留了既有的类别规则（read-only 排除已 modified）、排序、`read-files` 在 `modified-files` 前、空节省略和外层 `\n\n`。A 在同 parent 的**连续**已排序 run 内保持 leaf 顺序，且仅在 brace 文本严格更短时替换，故不重排或跨类别合并。C 只接受以 `read-files` 后 `modified-files` 为序的完整 terminal suffix，拒绝零节、空节、未知/重复/乱序标签、未消费尾部或无收益；这与当前 `summaryBodyEnd()` 的精确 terminal 边界相容。

## 调用者实际建立的前提

这不是由 TypeScript 类型推断得出：`extractCompactionFileOperations()` 对每一个 assistant `toolCall` 显式要求 `typeof args?.path === "string"` 且 path 非空，然后才将其放入集合。路径内容本身并不被限制为 POSIX、安全字符或无换行；因此 A 的真正调用前提必须允许任意非空 string，并在不安全/歧义路径上回退 baseline。候选 A 确实以 component 安全检查回退 `paths.join("\n")`，故无需凭类型假设路径一定安全。

`prepareCompactionRequest()` 的实际数据流是：

- `messages = filterBoulderResumeMessages(preparation.messagesToSummarize, undefined)`；
- `state = buildCompactionReferenceState(messages, preparation.previousSummary)`；
- **当前轮** `fileSuffix = formatCompactionFileOperations(extractCompactionFileOperations(preparation.messagesToSummarize))`；
- `referencesEnabled = state.sources.length > 0`；
- `finalizeSummary()` 对 original `state` 做一次 `expandCompactionReferences()`（仅 ON），对展开后的 `body.trim()` 判空，非空时仅追加该闭包中的当前 `fileSuffix` 一次。

`state.fileSuffix` 与上述当前 `fileSuffix` 不同：前者是 `previousSummary.slice(summaryBodyEnd(previousSummary))`，用于旧摘要的 terminal suffix；`sources`、`summarySourceCount` 和 `userOrdinals` 由该分离后的正文/当前纯文本用户消息构造并冻结。`serializeCompactionReferenceConversation()` 仍接收 original `state`，而 codec 的 ordinal、document、range/slice 解析和一遍展开也仍接收 original `state`。

## Hoare 审查（WP 逆推、SP 正推及循环）

### A：`formatCompactionPathList`

目标后置条件 Q_A 是：对 `B = paths.join("\n")`，返回 `B` 或可依序精确展开为 `paths` 的 raw/group 表示，且结果长度不大于 `B.length`；不写输入。

- **足够前提，不冒充最弱前提：** 输入是调用者构造的 string 数组；正常 JS 字符串/数组操作可完成，或可恢复异常进入 `catch`。路径不满足候选安全 grammar 时，A 的明确 SP 是 baseline。此条件足以证明 Q_A，但不是宣称机器层面的最弱前提（例如 OOM 不在 `catch` 保证范围内）。
- **反向 WP：** 对一个 group run，若 group 未严格短于 raw，必须选 raw；若选择 group，则其 `parent/{leaf,...}` 展开必须等于该 run。候选先验证每一个 component（至少两段、非空、非 `.`/`..`、安全字符），再仅在 `grouped.length < raw.length` 时选 group，满足这个充分 WP。任何一个 entry 不安全即整体返回 baseline。
- **正向 SP / 循环：** 外循环头 `start` 的不变量是 `lines` 精确展开 `paths[0:start)`，保持原顺序，长度不大于该 prefix 的 raw 表示，且每个已处理单元为一个连续 parent run。内层 `end` 的不变量是 `[start,end)` 都与 `first.parent` 相同；`end` 单调增加，variant `n-end` 下降。外层每轮令 `start=end>oldStart`，variant `n-start` 下降。singleton 加 raw；多项 run 加 raw 或可展开且严格短的 group。因此结束时 Q_A 成立。

### C：`compactCompactionFileSuffix`

目标 Q_C 是：原 suffix，或相同标签、相同顺序、每节按 A 可展开、严格更短的 suffix；不解析或改写正文。

- **足够前提：** 输入来自 original `state.fileSuffix`，即 `summaryBodyEnd()` 从 exact terminal `\n\n<tag>\n...\n</tag>` 边界切出的字符串；C 仍防御性处理非此形状输入。最弱前提不应被写成“suffix 一定合法”，因为旧摘要可能含任意路径字符串、标签样文本或畸形历史文本。
- **反向 WP：** 若本轮匹配的 section 没有 close、内容为空、不是 read→modified 的完整消费、零 section、或不严格更短，必须逐字返回输入。候选的 `offset` 与最终 `offset === suffix.length` 检查满足；`indexOf` 找到过早 close 时会因未消费尾部回退原串。
- **正向 SP / 循环：** 固定两次迭代（read、modified），不是无界搜索。第 i 次前 `sections` 等于已消费合法 prefix 的唯一重组，`offset` 指向其后首字节；每个成功分支只把该节路径列表交给 A。上界为两次，故终止。未知、重复、乱序、尾随正文/空白、CRLF 或不安全 path 都不会被“尽力清理”。

### D：renderer 接入、引用及 finalize

候选 `prepare-compaction-request.ts` 的 candidate.patch:136-147 只在 `referencesEnabled && preparation.previousSummary` 时创建：

```ts
{ ...state, fileSuffix: compactCompactionFileSuffix(state.fileSuffix) }
```

并只将这个浅复制体传给 `renderCompactionReferenceSummary()`。在该**窄分支**：

- SP 保持 `sources`、`summarySourceCount`、`userOrdinals` 的同一引用，故 source 文本、ordinal、user ordinal 对齐、同 document range、Unicode code-point slicing 和 codec 不变；
- `serializeCompactionReferenceConversation(messages, state, ...)` 仍是 original state，故注释位置、prompt conversation 投影和 literal escaping 不变；
- `expandCompactionReferences(state, draft)` 仍对 original state 扫描一次，不会以 display suffix 改写 reference source；
- `finalizeSummary` 的 body 判空与“展开一次、追加一次”控制流未改。

OFF (`state.sources.length === 0`) 根本不会调用 C/D；ON 且无 `previousSummary` 也仍使用 original state。因此候选 D 本身保持 OFF prompt 的逐字相等和现有 reference protocol。不应把这个局部正确性推广为整份候选正确：B 的持久化修改破坏了所需总后置条件。

## 阻塞项

### B1 — 当前 suffix 被持久化改写，而非仅旧 suffix 的 renderer 投影

- **精确位置：** `docs/simplify-compact-20260911/candidate.patch:76-84`，即对 `hooks/compaction-file-operations.ts` 的两处 `join("\n")` 替换为 `formatCompactionPathList(...)`。直接影响当前源码 `hooks/compaction-file-operations.ts:57-61` 的 `fileSuffix` 生成路径，以及 `hooks/prepare-compaction-request.ts:53-55,93-98` 的闭包追加路径。
- **违反的契约：** `design.md:9-11` 把 C/D 明确定义为仅接收 old `state.fileSuffix` 的显示投影，且“旧尾段只可能在本轮模型可见显示文本中变短，不被写回 state 或历史”。`APPROVED-SCOPE.md` 的 required behavior 13/16 要求保存 expanded summary 和 existing file suffix，并在一次展开后追加 file operations 一次。任务的范围也要求“只改变 renderer 显示投影”。B 却在 D 前把新一轮 B 的实际字符串变了；`finalizeSummary()` 会把该新字符串写入生产 summary。
- **最小反例（不依赖 provider）：** `messagesToSummarize` 仅含两个 assistant `edit` tool calls，路径分别为 `src/a.ts`、`src/b.ts`；无 previous summary、无纯文本 user source。因此 OFF，`referencesEnabled === false`。原行为的当前 suffix 为：

  ```text
  \n\n<modified-files>\nsrc/a.ts\nsrc/b.ts\n</modified-files>
  ```

  候选 B 的安全、同 parent、严格更短 group 为：

  ```text
  \n\n<modified-files>\nsrc/{a.ts,b.ts}\n</modified-files>
  ```

  对非空 draft `"x"`，original `finalizeSummary("x")` 保存前者；候选保存后者。C/D 未参与此分支，因此不能将它解释为“旧 tail 的模型可见临时显示”。下一轮 `buildCompactionReferenceState()` 又会把 brace 文本作为 `state.fileSuffix`，证明确实已进入历史 summary。
- **最小修复方向：** 不要修改 `formatCompactionFileOperations()`；保留 current `fileSuffix` 的 baseline raw newline 表示。只保留（或等效地只接入）C/D：在 ON + previousSummary 分支将 `compactCompactionFileSuffix(state.fileSuffix)` 放入 renderer 专用 shallow display state。若产品随后决定持久化新格式，那是与本次已批准范围不同的行为，必须重新授权、更新设计/测试和单独审查，不能作为“renderer-only”补丁合入。

该单一根因也解释了方案内部矛盾：`design.md` 声称只缩短旧显示尾段，而 `correctness.md:52,78` 又把“当前新 suffix 不变长”纳入目标。后者不能覆盖前者/批准范围要求的字符保持边界。

## 非阻塞核查结果

- **suffix 边界：** `summaryBodyEnd()` 仅分离 exact terminal LF tags；非 terminal 标签、尾随空白、CRLF、空节仍留在正文。C 对任何非精确语法回退原字节，故不会扩展这一解释边界。
- **引用 source / ordinal / userOrdinals：** candidate.patch 不改 state construction、source text、`summarySourceCount`、`userOrdinals` 或 serializer call；display clone 仅替换 string 字段。D 窄分支对此通过。
- **range slice / codec：** `compaction-reference-codec.ts` 未改；safe ordinal、same-document range、Unicode code-point half-open/negative slicing、一遍 decode/expand 与 unresolved neutral diagnostic 均未改。
- **路径类别及顺序：** B 的集合、read-vs-modified 规则、sort、标签顺序与外层格式保留；A 只在连续同 parent run 内按原 leaf 顺序群组。此项不抵消 B1 的持久化格式变化。
- **OFF prompt：** D 的 display state 只在 reference ON + old summary 分支形成；OFF prompt build 调用未动，现有测试确认 ordinary prompt byte-identical。这里的结论只关于 prompt，不错误宣称 B1 下的 OFF final summary suffix 仍逐字相同。
- **finalize：** patch 没有改变 original `state` 的一次展开、`body.trim()` 空正文返回 `""`、或控制流上的单次追加；但 B1 意味着被追加的一次 current suffix 内容已改变。应区分“追加次数不变”与“被追加文本不变”。
- **循环安全：** A 的两个有界/单调循环和 C 的两项固定循环满足初始化、保持、终止；没有观察到可达无限循环。

## 测试证据与其限度

执行并通过（38 tests, 0 failures）：

```sh
node --import tsx --import ./my-plugins/oh-my-pi-v2/test/prepare-compaction-request-loader.mjs --test my-plugins/oh-my-pi-v2/test/compaction-reference-*.test.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.test.ts my-plugins/oh-my-pi-v2/test/custom-compaction.test.ts
```

loader 中的 `completeSimple` 是 fail-fast guard；测试通过表示此基线没有越过 provider 边界。它覆盖 source state、codec、annotation、native composition、OFF prompt、空正文、一次展开、一次 suffix 追加和双轮行为。

但候选没有应用，且候选目录没有新增实际生产源码测试；所以该 38/38 **仅证明当前基线**，不证明 candidate 的 A/B/C/D 集成、brace 显示行为或 B1 修复后的回归通过。尤其现有 finalization 测试使用单路径 suffix，无法暴露上述两个同目录路径的严格缩短分支。未来 source-level regression 至少必须加入该 OFF 反例，并断言 raw current suffix 仍保存；另外再单独断言 ON + old summary 时仅 renderer prompt 中的旧 suffix 可以缩短，original state/finalize 输出不变。

## 验证命令

```sh
git apply --check my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch
git apply --numstat --check my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch
git diff --check -- my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911
```

均成功；这些检查仅证明补丁可解析/可应用和所审目录没有 whitespace error，不证明 TypeScript、运行时加载、真实模型调用或生产 compaction 行为。

## 工作树/暂存边界

审阅相关的两条现有 production 源文件没有未提交 diff，方案目录是未追踪候选文档。工作树在审查前已有大量无关改动；索引中已有九条无关路径暂存（包含 `my-plugins/oh-my-pi-v2/README.md`、三个 agent 文档、`config.ts` 和三份 sisyphus prompt hook）。本审查没有暂存、取消暂存或修改任何项目路径，因此不能声称仓库“无暂存文件”。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "not-satisfied",
      "evidence": "candidate.patch:76-84 changes the persisted current fileSuffix, violating the renderer-only approved scope; B1 provides a provider-free OFF counterexample."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Full independent read-only report records exact candidate locations, contracts, counterexample, patch applicability/statistics, source/control-flow evidence, and bounded test evidence."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git apply --check candidate.patch",
      "result": "passed",
      "summary": "Candidate applies cleanly without writing."
    },
    {
      "command": "git apply --numstat --check candidate.patch",
      "result": "passed",
      "summary": "Four files, +94/-3."
    },
    {
      "command": "node --import tsx ... --test compaction-reference/prepare-request/custom-compaction tests",
      "result": "passed",
      "summary": "38 passed, 0 failed; provider guard was active."
    }
  ],
  "validationOutput": [
    "candidate.patch physical record: 150 lines; numstat: 55/0, 8/2, 26/0, 5/1.",
    "B1 blocker: current generated suffix is persisted in brace form outside the old-suffix renderer projection."
  ],
  "residualRisks": [
    "Do not merge until B1 is removed or the broader persistence change receives separate approval and implementation/test review.",
    "Passing facade tests are current-source baseline only because the candidate patch was intentionally not applied."
  ],
  "noStagedFiles": false,
  "diffSummary": "No project-file modifications were made by this review. Candidate proposes two new formatters and two hook changes; B1 blocks it.",
  "reviewFindings": [
    "blocker: candidate.patch:76-84 - changes current persisted fileSuffix rather than only the old suffix renderer display projection."
  ],
  "manualNotes": "Pre-existing unrelated staged files were observed and left untouched."
}
```