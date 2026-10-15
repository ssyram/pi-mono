# CCA PRE/POST 审核 — skill-ref 修饰符基础设施

## 结论

**不能接受“所有函数都没有问题、不会抛出、始终返回合法值”的整体保证；当前不应以该保证接入。**

CCA 正常完成，不等于其每条契约都成立。父线程已完整读取 32 份函数报告、26 份外部报告、goal/self-check/open-questions，对照全部 12 个受析源文件和 pi-tui 的 provider、Editor、SelectList 调用链，并运行有限反例。发现 6 组具体问题或保证缺口；没有修改实现或测试文件。

一般字符串、普通数组/数据对象、只读同步 reader、遵守同步接口的下层 provider 场景下，现有 41 项测试仍有意义。不能将这组场景扩大成“任意第三方返回值/getter/回调下均安全”。

## 1. 目的、范围与依据

- 用户原始要求：print/path、任意横向空白等价、唯一精确资源才能转换、转义和自动补全；只实现基础设施、不接入。
- 重点安全要求：pi 对接函数不向框架抛出，不给框架非法返回值。审核标准是原需求与真实 pi 参数合同，不是 CCA 的 aligned 标记或实现自述。
- 本次范围：新增基础设施及其 matching/registry 依赖，12 文件、32 函数；未接入的输入事件、首行防护、原工具指引不属于已证明行为。
- CCA run：`skillref-cca-20261014-160356-6fe14f`，root `ses_ec68f77adffei15j3Ki0NRI67K`，模型 `tmp-haokun/glm-5.3-flash`。
- 输入快照：`.pi/cca-runs/<run>/workspace/src/`；原源码与快照的 12 个 SHA-256 均与启动 manifest 一致。
- 分析材料：同 workspace 的 `_cca_analysis/`；完整父审输入副本位于该 run 的 `parent-review-inputs-complete/`。
- 正常终态依据：root 的 transition 先从 A_DISPATCH_CLOSE 请求 A_DONE 被拒，随后同一正常边 accept；没有 A_FAILURE_REVIEW 退出；exit_fsm 返回 `_default`、stack_depth=1，root 与全部子会话 idle。
- 监控中的 BLOCKED 命中来自历史文本，不是最终报告；不能把这种全文标签匹配当终态判定。已取消监控、停止专属 server，保留全部证据，共享 daemon 未动。

## 2. 可运行反例

源脚本：`my-plugins/skill-ref/.pi/cca-counterexamples.ts`。生成产物与运行输出仅属于父审证据，不是生产修复或回归测试替代品。

仓库根执行：

```sh
node_modules/.bin/esbuild my-plugins/skill-ref/.pi/cca-counterexamples.ts --bundle --platform=node --format=esm --packages=external --alias:@earendil-works/pi-tui=./packages/tui/src/index.ts --outfile=my-plugins/skill-ref/.pi/cca-runs/skillref-cca-20261014-160356-6fe14f/parent-review-inputs-complete/cca-counterexamples.mjs
node my-plugins/skill-ref/.pi/cca-runs/skillref-cca-20261014-160356-6fe14f/parent-review-inputs-complete/cca-counterexamples.mjs
```

两个命令均退出 0，表示下列反例已按断言复现；不是表示实现通过安全审核。异步拒绝反例在隔离的本地子进程中运行，子进程预期退出 1；无模型/API 调用，无生产代码修改。

## 3. 发现与对 CCA 契约的裁决

### F1 — applyCompletion 可返回越界光标（直接 pi 边界）

位置：`src/modifier-autocomplete.ts:49,58,62`。

`item.value` 被独立读取三次。传入一个 value getter，前两次返回 `:print`、第三次返回长字符串，所有读取结果仍为 string，其他参数也合法。复现输出：新行长度 10，cursorCol=1005。

CCA 将“getter 值稳定/候选为普通对象”当作 pi 合法 item 的一部分，但 `AutocompleteItem` 只声明字符串字段，没有这个条件。`packages/tui/src/components/select-list.ts` 保留原候选对象；`editor.ts:765-806` 和 createAutocompleteList 回调直接传入选中对象，并直接消费返回的行与光标；setCursorCol 不负责范围校验。不能据调用链证明此额外前提。

**裁决：** POST“恒合法编辑”对公开结构类型的合法值不成立。普通稳定候选场景可条件成立；不能将未声明的稳定性当作已经由 pi 保证的事实。

### F2 — loader 的绝对路径 POST 可失效，transformReferences 可抛出

位置：`src/exact-resource.ts:21-24`、`src/transform-references.ts:24,27`。

loader 校验 path 后，将原 entry 交给 reader，并将同一 entry 引用返回。合法同步 ResourceReader 可以改变该可变对象：

- 将 path 改为 `relative.md` 并返回 body，loader 仍返回成功，违反“成功路径必为绝对路径”。
- 将 path 改成会抛 `mutated-path-read` 的 getter，reader 正常返回 body；transformReferences 随后在自己的 catch 边界之外读取该字段，异常逃逸。

CCA 的 external-read 明确不承诺“不修改 entry”，同时 loader POST 和 transform 的 demand 又要求读取后路径稳定且绝对；这两者不能组合。没有 await 不代表同步回调/getter不能造成检查后变化。

**裁决：** nothrow 与路径 POST 的实际保证缺口已复现。默认只读 readFileSync + 普通稳定 registry entry 场景可成立，但公开 reader 类型/现有声明没有限制 mutation，不能凭“读取函数”称呼补出这个义务。

### F3 — Array.isArray 不保证标准迭代器

位置：`src/autocomplete-result.ts:15,17,27`。

输入 items 是长度 1 的真实数组，但其自有 Symbol.iterator 是立即结束的有限 generator。归一化返回非 null 且 `items.length=0`。

CCA 以 Array.isArray + length>0 推出 for-of 恰访问 length 个索引，从而推出输出非空；这个推导不成立。此反例符合“任意第三方返回值”和终止性前提，不需要无限循环或修改全局内建。

**裁决：** 违反归一化 POST 的“非空”承诺。当前 Editor 会取消空菜单，因此此反例本身不是崩溃证明；不能因此把错误 POST 算作成立。normalizeAutocompleteEdit 的复制后范围检查能拒绝空输出，不能与 suggestions 的缺口混为一谈。

### F4 — 原有 listEntries 不是无条件 never-throw

位置：`src/registry.ts:49-63`。

catch 仅包住 getCommands 调用，遍历及字段访问在外。回调返回可迭代数组，元素 name 合法，但 source getter 抛出 `command-source-getter`，异常原样逸出。不可迭代返回值也会逸出 TypeError。

CCA 声称“元素可任意畸形且逐字段容忍、除可迭代外没有前提”，并声明循环体无可抛操作；复现否定该条。“属性值为字符串”也不自动排除会抛出的 getter。

**裁决：** 原有依赖的宽泛保证错误；不能用它证明完整 registry→adapter 链不会抛。新增三个 provider 回调中的 getEntries 调用位于 catch 内，能收束该同步异常，因此不能把依赖问题直接等同于新增 callback 必定崩溃。

### F5 — 错误同步返回类型中的异步拒绝不被同步 catch 收束

位置：`src/modifier-autocomplete.ts:52`、`src/autocomplete-result.ts:33`。

下层 applyCompletion 错误地返回 rejected Promise，wrapper 将它按错误形状拒绝并返回合法原快照，但 rejection 没有被消费。隔离子进程使用 `--unhandled-rejections=strict`，打印返回原快照后，以 `downstream-edit-rejection` 退出 1。

**裁决：** 这违反了下层的同步接口，不是正常 pi provider 行为；但设计明确纳入第三方错误返回形状，不能同时宣传该扩展安全面完整，又用静态签名排除这个反例。当前实现只收束同步 throw，不保证错误 thenable 的后续拒绝不会破坏宿主。

### F6 — 转义种类名菜单缺口

位置：`src/modifier-context.ts:12`。

`/skill\\:pr` 的单个转义反斜杠形式返回 null；对应发送形式会删除反斜杠并保持字面 `/skill:print`。拒绝裸种类前缀的分支没有排除 escaped。

**裁决：** CCA 的 mismatch 有源码依据。影响只在资源名恰为 skill/prompt 等裸名的紧贴转义菜单；宽泛“所有名字的转义补全”不能成立。默认带空格 `/skill \\:pr` 和双冒号形式不受该分支影响。用户没有要求新增这种例外，不能靠改写 POST 为“也拒绝转义”消掉实现缺口；修复或明确收窄需另获决定。

## 4. 32 个函数的 PRE/POST 对照摘要

“条件成立”只表示在普通、有限、类型正确数据及标准未被改写的内建语义下，没有在本次审核发现新增违反；不是形式证明，不包括未声明的任意副作用、挂起或无限资源。

| 源文件/行 | 函数 | 审核结果 |
|---|---|---|
| autocomplete-result.ts:9 | normalizeAutocompleteSuggestions | F3：非空 POST 不成立；同步异常 catch 的作用可确认 |
| autocomplete-result.ts:33 | normalizeAutocompleteEdit | 条件成立：复制后类型/非空/整数及光标界检查；外部迭代终止是独立前提 |
| exact-resource.ts:13 | loadExactReference | F2：返回原 entry，读取后路径保证不成立 |
| match.ts:17 | splitQualified | string、普通内建条件下成立；并非任意输入 nothrow |
| match.ts:23 | escapeRegex | 转义语义条件成立；CCA 把 14 个 SyntaxCharacter 写成 12，是报告错误 |
| match.ts:28 | stripWildcards | string 条件下成立 |
| match.ts:33 | normalizeQuery | string 条件下成立；不合法接收者可抛 |
| match.ts:38 | compileQuery | 合法语法构造可确认；资源上限与共享 RegExp 的不被修改不能凭 flags 证明 |
| match.ts:58 | findExact | 匹配规则条件成立；异常传播是已声明出口，loader负责 catch |
| match.ts:64 | filter callback | 普通 entry 数据条件下匹配规则成立；getter 异常可传播 |
| match.ts:74 | findExactIgnoringCase | 普通字符串字段条件下成立；不是不可信元素下不抛 |
| match.ts:78 | filter callback | 接收者/字段条件下成立 |
| match.ts:90 | findFuzzy | 条件成立；CCA 的负无穷 limit 全池描述错误，实际至多 1 条 |
| match.ts:95 | filter callback | 普通字段条件下成立；“普通对象”不能从结构类型自动推出 |
| match.ts:104 | search | 普通字段、数值 limit 下规则成立；依赖具体 fuzzyMatch 与内建资源边界 |
| match.ts:107 | filter callback | 字符串/合法 RegExp 条件下成立 |
| match.ts:108 | filter callback | 字符串字段条件下成立；“非 Symbol 即安全转换”对任意对象不足 |
| match.ts:112 | map callback | 普通 entry 与具体 fuzzyMatch 条件下成立；异常源不能忽略属性读取 |
| match.ts:119 | sort callback | 原位 index 与数字/string 数据条件下成立；同一元素比较为 0，不是报告声称的严格非自反关系 |
| match.ts:126 | map callback | 真实上游对象字面量保证下成立；不应表述成脱离来源的无条件不抛 |
| modifier-autocomplete.ts:8 | createModifierProvider | 同步 trigger读取/构建异常 fallback可确认；工厂返回完整回调不证明全部回调 POST |
| modifier-autocomplete.ts:18 | filter callback | 基础值类型/单字符判定成立 |
| modifier-autocomplete.ts:26 | getSuggestions | catch涵盖同步与 awaited rejection；合法输出依赖 F3；下层 settle/终止是前提 |
| modifier-autocomplete.ts:41 | applyCompletion | F1/F5；快照在 catch 外也依赖可迭代 lines，不是任意参数安全 |
| modifier-autocomplete.ts:49 | some callback | 允许 item getter 异常向外层 catch传播；匹配时依赖 F1 的值稳定性 |
| modifier-autocomplete.ts:68 | shouldTriggerFileCompletion | 同步 boolean/fallback可确认；异步非法返回及不终止回调不在该同步 catch的保证内 |
| modifier-context.ts:4 | extractModifierContext | F6；合法行/光标下的有限解析成立，非法行可抛并由 provider catch |
| modifier-items.ts:4 | getModifierItems | 内部 context 普通对象及固定枚举条件下成立；不是任意对象入口不抛 |
| printed-resources.ts:1 | formatPrintedResources | 固定格式/原文保留成立；不应把可捕获的字符串长度 RangeError 全归为进程终止 |
| reference-occurrences.ts:4 | parseReferenceOccurrences | 固定枚举/string条件下区间规则成立；最小宽度 7，CCA caller写 8 的勘误不改变推进证明 |
| registry.ts:40 | listEntries | F4，元素安全及 never-throw保证过强；path表达式也未做 typeof字符串检查 |
| transform-references.ts:6 | transformReferences | F2，依赖未成立的 loader POST；普通只读场景的去重/保序/失败原样规则成立 |

## 5. 外部假设与测试边界

- 完整读取 26 份外部报告。它们不是可信公理：Array.isArray 不保证 iterator、entry属性可变、reader可修改实参等必须纳入调用点。
- external-isArray 的“不抛”对 revoked Proxy不成立；现有归一化 catch可吸收，故这是 CCA 假设错误，不是新增逃逸证明。
- external-startsWith 的“非 string前缀必抛”错误；非 RegExp 值可按标准强转。现有调用传字符串，当前路径不受影响。
- 字符串/正则尺寸上限导致的 RangeError/SyntaxError 可以是可捕获异常，不能一概与 OOM/进程被杀混记。不运行可能消耗大量资源的反例；未证明任意有限尺寸下不抛。
- CCA 将 fuzzyMatch 当黑盒，因此其 unknown/可能抛不等于当前依赖真的有此错误。父审已读取 packages/tui/src/fuzzy.ts：正常 string输入下同步有限循环、返回 matches/数值 score；这支持常规匹配链，不消除其他路径的缺口。
- Editor/SelectList 源码显示直接传递候选、直接写入编辑结果，不能假设框架会修正越界光标。
- 41 项原测试在 CCA前已重新编译执行通过；源哈希未变。6 组有限反例揭示测试未覆盖的承诺，不能用这 41 项通过证明不存在这些问题。
- CCA框架正常退出、报告齐全、aligned 31/32、unknown汇总为0，都不能替代逐条契约成立。

## 6. 本次交付与未完成责任

本次完成的是独立 CCA + 父线程 PRE/POST 审核。没有向 CCA追加分析指示，没有更换模型，没有改受析源码，没有接入。

若要达到用户提出的整体安全承诺，需要另行处理上述实现/契约缺口并补相应回归测试；不能仅收窄 PRE 来让报告通过。首行原生展开防护和真正接入仍是原先独立未完成项。此报告不授予修复或接入许可。
