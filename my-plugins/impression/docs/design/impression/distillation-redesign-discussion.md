# 蒸馏过程重新设计 — 详尽讨论文档

> 范围：把蒸馏过程从触发到落盘的每一步都列清楚，逐步标出"可能出错的方式 + 推荐处理"。
> 简化前提：**把所有打断（软的 Esc / 硬的崩溃 / 断电）一律当作进程死亡来分析**——也就是认为打断瞬间没有 cleanup 机会，下次启动只能从 JSONL 日志重建状态。这把 `signal.aborted` 的语义和 OS-level 中断对齐成一回事，避免在两层重复推理。

---

## 0. 简化模型

蒸馏本身就是一个三步函数：

```
   compose context  →  LLM call  →  parse + classify
                                            │
                                            ▼
                              { kind, note?, thinking? }
                                            │
                                            ▼
                          caller 根据 kind 决定怎么写 JSONL
```

困难不在主线，困难在：
1. **每一步可能出什么问题**（输入异常 / context 异常 / API 异常 / parse 异常 / 分类不准）
2. **每一步如果突然被打断**会留下什么"半成品"，下次 session_start 重放时如何识别和恢复
3. **LLM 实际可以返回什么**——`stopReason` 五种 × content 多种组合，要把所有可能列清楚，不能再"按经验猜"

---

## 1. 流程分步（with persistence state at each step）

下面把蒸馏调用的整条链路按"调用栈位置 + JSONL 状态"标清。
`[JSONL]` 标记进入每一步时**已经持久化到日志**的内容。

### 流程 A：`tool_result` event handler 进入蒸馏

| Step | 动作 | `[JSONL]` 入口状态 |
|---|---|---|
| **A0** | framework 触发 `tool_result` event | tool_call entry 已存（framework 在调用工具前 append）；**tool_result 未存** |
| **A1** | 短路检查：`event.toolName === "recall/skip_impression" \|\| !cfg.enabled` | A0 |
| **A2** | passthrough 模式分支（如适用，含 reject 路径） | passthrough-rejected 路径会 `appendEntry` 一个 impression-v1 条目 + `persistPassthroughRemaining` |
| **A3** | `shouldSkipDistillation(toolName, cfg)` → 跳过 | A0 |
| **A4** | `serializeContent(content)` → `fullText` | A0 |
| **A5** | `fullText.length < cfg.minLength` → 跳过 | A0 |
| **A6** | `ctx.model` / `ctx.modelRegistry.getApiKeyAndHeaders` | A0 |
| **A7** | 组装 visibleHistory + systemPrompt + userPrompt + maxTokens + variant | A0 |
| **A8** | **`complete(model, ctx, opts)`** ← 网络调用，AWAITABLE，可被 abort | A0 |
| **A9** | parse response.content → 抽 `<thinking>`、得 `strippedText` | A0 |
| **A10** | 分类（sentinel / empty / blowup / normal） | A0 |
| **A11** | post-distill 副作用：`recordImpressionData` → `persistSessionStats` | session-stats entry 写 JSONL |
| **A12** | 若 distilled 成功：`newImpression` → `impressions.set` → `appendEntry(IMPRESSION_ENTRY_TYPE, impression)` | impression-v1 entry 写 JSONL |
| **A13** | return `{content: ...}` 给 framework | A12 |
| **A14** | framework 把 return 的 content 作为 tool_result message 写 JSONL | tool-result message 写 JSONL |

### 流程 B：`recall_impression.execute` 进入蒸馏

| Step | 动作 | `[JSONL]` 入口状态 |
|---|---|---|
| **B0** | LLM 主动调用 `recall_impression(id)` | 对应的 tool_call 已存；tool_result 未存 |
| **B1** | `impressions.get(id)`；若 undefined → throw | B0 |
| **B2** | `impression.delivered === true` → throw（已交付，content 已弃） | B0 |
| **B3** | passthroughRemaining 分支 / recallCount 满 / model auth fail → 直接 `deliverFullContent` 走完即返回 | 各分支自己 appendEntry |
| **B4** | 组装 visibleHistory（包含 fresh history 但 impression.fullContent 是**快照**） | B0 |
| **B5** | **`complete(...)`** ← 网络调用 | B0 |
| **B6** | parse → 分类（同 A9-A10） | B0 |
| **B7** | 若 passthrough: `recallCount = maxRecall` → `deliverFullContent`（写 stripped 版 impression-v1） | B7 写 JSONL |
| **B8** | 若 distilled: `recallCount += 1` → `appendEntry(impression-v1, impression)` | B8 写 JSONL |
| **B9** | return 给 framework | 同 A13/A14 |

---

## 2. 硬打断在每一步的后果 + 恢复行为

> 全部按"打断 = 进程死亡 + 无 cleanup"分析。下次 `session_start` 时只能读 JSONL 重建。

### 流程 A 的打断分析

| 中断时刻 | 已写 JSONL | 未完成的事 | 下次 session_start 看到的 | 恢复行为推荐 |
|---|---|---|---|---|
| **A0–A8 之间**（含 API 调用全程） | tool_call only | tool_result 整条 | tool_call 没有匹配的 tool_result（孤儿） | **由 framework 兜底**：framework 检测到 dangling tool_call 会自行处理（重发、报错、或要求 LLM 重新决策）。impression 插件**什么都不做**。 |
| **A8 → A9 之间**（响应已收到但没来得及 parse） | tool_call | parse + 分类 + 副作用 + return | 同上：tool_result 缺失 | 同上。响应内容**被丢弃**，没有损失因为它从没被持久化。Provider 那边可能仍计费——这是无解的，承认即可。 |
| **A11 进行中**（`persistSessionStats` 在写 JSONL） | tool_call；session-stats 可能写了一半 | impression entry 没写；return 没发生 | 一条**可能损坏**的 session-stats（或者 fsync 没完成的尾巴） | session-stats 的 type guard `isSessionStatsEntry` 会把损坏行 reject，自动用上一条有效 stats 即可。**不需要特殊处理**。 |
| **A12 进行中**（`appendEntry(IMPRESSION_ENTRY_TYPE, impression)` 在写） | tool_call + session-stats + 一半的 impression-v1 | return | 同上：损坏的 impression-v1 被 type guard reject，没有这条 impression。但 stats 已 commit，会被多算一次（fullText 字符已计入 cumulativeImpressionChars）。 | 这个**真有数据漂移**：stats 比真实"已存的 impression"多统计一次。但: (a) stats 只用于 UI 显示，不参与决策；(b) 漂移幅度等于 1 个 tool result 的 chars；(c) 修不修都不影响正确性。**承认+不修**最简单。 |
| **A13 之后、A14 之前** | impression-v1 + stats | tool-result message | impression-v1 已存，但没有对应的 tool-result 把 impression 文本送进 LLM context | tool_call 缺 tool_result——framework 兜底（同 A0-A8）。impression 已经在内存 Map 里"孤立存在"，但 `recall_impression` 永远不会被调（因为 LLM 没看到 impression text 也就没拿到 id）。**正常的孤儿数据，不需要清理**——下次 session 它静静存在 JSONL 里，无害。 |

### 流程 B 的打断分析

| 中断时刻 | 已写 JSONL | 未完成 | 重建时所见 | 推荐 |
|---|---|---|---|---|
| **B0–B5 之间** | recall_impression 的 tool_call | tool_result | tool_call 缺 tool_result | framework 兜底；impression 已有的状态（delivered=false，recallCount 不变）保留。 |
| **B5 → B6/B7/B8 之间** | 同上 | 同上 | 同上 | 同上 |
| **B7 进行中**（`deliverFullContent` 在写 stripped impression） | 损坏的 impression-v1 | return | type guard reject，**保留旧的 impression-v1**（fullContent 还在），`delivered` 仍是 false | 这是**好的**——下次 LLM 再 `recall(id)`，会重新走完整 distill，不会"已交付但内容丢了" 这种恐怖情况。 |
| **B8 进行中**（`appendEntry(impression)` 写 incremented recallCount） | 损坏的 impression-v1 | return | type guard reject，保留旧 recallCount | 也是好的——下次 recall 拿到的是"还没用完的"recallCount，最多多 distill 一次，无害。 |

### 总体观察

- **`appendEntry`/`persistXxx` 是 "all or nothing" via type guards** —— 损坏的 JSONL 行不会被静默接受。这是当前设计**最关键的安全网**。所有的"中途中断"基本都退化成"什么都没发生"或"漏统计了 1 单位"。
- **唯一真损失：A11 → A12 之间的 stats 漂移**。但由于 stats 只用于 UI，影响可忽略。
- **不需要为打断设计任何"恢复协议"** —— 每次 session_start 重放就是天然的恢复。

> 设计建议：保持现状的 disk-first + type-guard-on-replay 模式，**不要引入显式的 "in-flight transaction" 状态**（会让恢复逻辑暴涨）。

---

## 3. LLM 可能返回什么 — 详尽枚举

`pi-ai` 的 `complete()` 返回 `AssistantMessage`，关键字段是 `stopReason: "stop" | "length" | "toolUse" | "error" | "aborted"` 和 `content: ContentBlock[]`。

### 3.1 按 `stopReason` 划分

| stopReason | 含义 | content 通常长啥样 | 当前代码处理 | 是否真问题 |
|---|---|---|---|---|
| `"stop"` | 模型自然停止 | 正常文本（含可能的 thinking 块） | 进入 parse + 分类 | OK |
| `"length"` | 撞到 max_tokens | 半截文本，可能停在句中或 `<thinking>` 中段 | round-6 加了显式守卫：`{passthrough: true, note: "[DISTILLATION TRUNCATED ...]"}` | OK |
| `"toolUse"` | 模型要调工具 | 含 ToolCall block | distill 不传 tools，理论不会出现；万一出现会 fall through 到 parse → strippedText 可能为空 → 走"empty"分支 | **理论可能漏**：建议显式当 anomaly 处理 |
| `"error"` | provider 报错 | 一般为空 / 错误信息 | **未显式处理**：fall through 到 parse → strippedText 空 → 当 sentinel passthrough 静默返回 | **真问题（B1）**：错误被吞 |
| `"aborted"` | signal abort | 一般为空 | 同上：当 sentinel passthrough | **真问题**：用户 Esc 被当成 "模型决定 passthrough" |

### 3.2 按 content 内容划分（在 stopReason="stop" 前提下）

在我们 strip 掉 `<thinking>` / `<think>` 之后得到 `strippedText`，对它的所有可能形态：

| content 形态 | 触发条件 | 当前判定 | 推荐 |
|---|---|---|---|
| **纯空** | strippedText.trim() === "" | `passthrough=true, note=DISTILLER_SENTINEL` | 应该单独标记为 **"empty"** kind，与 sentinel 区分。empty 通常意味着模型只输出了 `<thinking>` 没给真正答案——是异常 |
| **纯 sentinel** | sentinelLike === DISTILLER_SENTINEL | `passthrough=true, note=strippedText` | OK，这是模型主动决定 |
| **sentinel 加修饰**（引号、句号） | sentinel 周围有 `"`/`'`/`` ` ``/`.`/`!`/`。` | 当前用 strip 后比对，能匹配上 | OK，但要注意：模型偶尔会写 `'<passthrough/>'` 或 `"<passthrough/>"` 加上下文比如 `As you can see, <passthrough/>`——后者目前会 fall through 当成普通 text |
| **sentinel 嵌入正文** | 文本里出现 sentinel 但前后还有别的内容 | 当前不识别，按普通 text 处理 | **新设计要决定**：算 passthrough 还是算 distilled？我倾向"看到就是 passthrough，丢弃伴随文本" |
| **正常蒸馏笔记** | 正常文本，长度 < 原文 | `passthrough=false, note=strippedText` | OK |
| **过长**（≥ 原文） | strippedText.length >= contentText.length | `passthrough=true, note="[FAILING DISTILLATION ...]"` | OK，但 note 永远不会被展示给 LLM（caller 用原文），所以这条信息丢失。建议保留分类信号 |
| **格式垃圾**（malformed JSON、XML 残片、模型自我对话） | 不合预期但合 string | 按普通 text 处理 → 写入 ImpressionEntry | **真风险**：我们没有任何 schema 验证。模型有时会输出 `Here is my distillation:\n\n<note>...` 这种 wrap。建议加一条"如果 strippedText 看起来像在自我介绍而不是直接给笔记，警告" |
| **包含 sentinel 的 thinking** | `<thinking><passthrough/></thinking>` 后正文 | thinking 被 strip 掉，sentinel 不在 strippedText 里 → 不触发 passthrough | OK——模型在 thinking 里只是在"思考要不要 passthrough"，不算最终决定 |
| **多块 text content** | `response.content = [TextContent, TextContent, ...]` | 当前用 `\n` join → 合并后 strip → 同上判定 | OK |
| **包含 ImageContent** | content 里混了图片 block | 当前 `.filter` 只取 text，图片被忽略 | OK，蒸馏不应输出图片 |

### 3.3 全部 LLM 输出的统一分类（推荐新设计）

把上面所有情况收敛成一个 tagged union：

```ts
type DistillOutcome =
  | { kind: "distilled"; note: string; thinking?: string }
  | { kind: "model-passthrough"; thinking?: string }
  | { kind: "model-blowup"; rawNote: string; thinking?: string }
  | { kind: "model-empty"; thinking?: string }                      // 输出仅 thinking，无正文
  | { kind: "model-tool-use"; thinking?: string }                   // 不该发生，但要兜
  | { kind: "truncated"; partialNote: string; thinking?: string }   // stopReason="length"
  | { kind: "api-error"; reason: string }                            // stopReason="error"
  | { kind: "user-abort" }                                           // stopReason="aborted"
  | { kind: "unknown"; debugDump: string };                          // 全部兜底
```

每个 caller 可以基于 kind 做策略而不是只看一个 boolean：
- `distilled` → 创建 impression。
- `model-passthrough` / `model-blowup` / `model-empty` → 走 passthrough 路径（用 `event.content`），但**记录原因**到 ctx.ui.notify 让用户能看出来。
- `truncated` → 同上，且额外提示"上限太低"。
- `api-error` / `user-abort` → 走 passthrough 路径（保证 agent 拿到原文），但**额外 ctx.ui.notify 告知用户：这次蒸馏未发生**。不创建 impression。
- `unknown` → 走 passthrough 路径，**debugDump 写到 notify**——出现这条说明有未识别的形态，需要人去看。

---

## 4. 每个步骤的"可能出错"清单 + 推荐

### 4.1 Compose context（A4–A7 / B4）

| 可能问题 | 当前 | 推荐 |
|---|---|---|
| `serializeContent` 处理空 content | 返回空字符串 | 上层已经被 `fullText.length < minLength` 兜住，OK |
| visibleHistory 极长（几 MB） | 直接 stringify 拼接，内存 + 后续 prompt token 双重压力 | 设计阶段决定：是否要 cap visibleHistory size？或者抽尾部 N 条消息？ |
| originalSystemPrompt 缺失 | 用 `[none]` 占位 | OK |
| `convertToLlm` 抛错 | 当前没有 try/catch | **建议**：用 try/catch 包，失败则 visibleHistory = `"[history unavailable]"`，蒸馏继续 |
| variant 选择基于 model.id 字符串前缀 | 硬编码 ad-hoc | 抽成 config 字段或 model registry 元数据 |

### 4.2 Auth resolution（A6）

| 可能问题 | 当前 | 推荐 |
|---|---|---|
| `model` undefined | `notifyImpressionSkip` + return undefined | OK |
| `getApiKeyAndHeaders` returns `!ok` | 同上 | OK |
| key/headers 中途过期 | `complete()` 内 retry，retry 失败 → stopReason=error | 走 api-error kind 处理 |

### 4.3 API call（A8 / B5）

| 可能问题 | 当前 | 推荐 |
|---|---|---|
| 网络中断 | `complete()` 内 retry；最终 `stopReason=error` 或 throw | 当前如果 throw，handler 会把异常向上抛，framework 看到 unhandled rejection。**建议**：在 distill 函数 try/catch，失败统一返回 `{kind: "api-error"}` |
| max_tokens 撞顶 | `stopReason="length"` 已正确处理 | OK |
| signal abort | `stopReason="aborted"` 但当前被吞 | 显式归类为 `user-abort` |
| provider 返回 4xx/5xx | 同 throw | 同上 try/catch |
| provider quota / billing 错误 | 同上 | 同上，但要在 notify 里加 hint |
| 返回时间巨长（无 abort） | hangs 直到外部 signal | 不归 distill 管，由 framework signal 触发 abort |

### 4.4 Parse + classify（A9–A10 / B6）

| 可能问题 | 当前 | 推荐 |
|---|---|---|
| `<thinking>` 嵌套 | regex 是非贪婪 `[\s\S]*?`，能匹配最内层 | OK |
| `<thinking>` 不闭合 | 只 strip 闭合的，未闭合的留在 strippedText 里 | **建议**：检测到不闭合 → 当作 truncated/anomaly |
| sentinel 大小写 | 当前严格匹配 `<passthrough/>` | 建议 case-insensitive |
| 多个 sentinel 同时出现 | 第一个被 strip-replace-trim 后的 sentinelLike 比对——可能匹配不上 | 改成 "字符串包含 sentinel 即视为 passthrough"（更宽容） |
| strippedText.length 计算 vs contentText.length 比较 | char-level 比较 | OK 但要文档说明（不是 token-level） |
| 返回里没有任何 TextContent block | text="" → strippedText="" → empty 分支 | OK |

---

## 5. 未知 / 兜底 (`unknown` kind)

为了把"将来想都没想过的情况"也兜住，新设计建议**永远不要返回 throw**，而是把所有不属于上述明确 kind 的情况收口到：

```ts
{ kind: "unknown", debugDump: <stringified response or error> }
```

caller 看到 `unknown` → 走 passthrough（保证 agent 不卡死）+ `ctx.ui.notify` 把 debugDump 摆出来 + 建议把 debugDump 复制到 issue。这就是**所有未知情况的统一兜底**。

---

## 6. 关于"打断"的最终结论

按本文档的简化前提（一切打断当硬中断），结论是：

1. **没有"中途状态"需要恢复**——type-guard-on-replay 把损坏的 JSONL 行自动剔除。
2. **没有损失**——除了 stats 偶尔多算一次（无害）。
3. **provider 计费可能有零星损失**——无解，承认即可。
4. **不需要 "in-flight" 标记 / 不需要 lock 文件 / 不需要事务**——这些都是过度工程。

也就是说：**蒸馏过程不需要任何"中断恢复协议"**。设计精力应该花在分类输出和错误处理（§3 / §5），而不是在中断恢复。

---

## 7. 推荐的最小重设计

把当前 ~135 行 `src/distill.ts` 改成这样：

```
distill(): Promise<DistillOutcome>
  ├─ try
  │   ├─ compose context（visibleHistory / systemPrompt / userPrompt / maxTokens / variant）
  │   ├─ const response = await complete(...)
  │   ├─ switch (response.stopReason)
  │   │     case "length"  → return { kind: "truncated", partialNote, thinking }
  │   │     case "error"   → return { kind: "api-error", reason: response.errorMessage }
  │   │     case "aborted" → return { kind: "user-abort" }
  │   │     case "toolUse" → return { kind: "model-tool-use", thinking }
  │   │     case "stop"    → fall through
  │   ├─ extract text + strip thinking
  │   ├─ classify text:
  │   │     contains sentinel → { kind: "model-passthrough", thinking }
  │   │     empty             → { kind: "model-empty", thinking }
  │   │     length >= original→ { kind: "model-blowup", rawNote, thinking }
  │   │     else              → { kind: "distilled", note, thinking }
  │   └─ return classified outcome
  └─ catch (e)
       return { kind: "unknown", debugDump: stringify(e) }
```

caller 端用 switch over `outcome.kind` 决定动作。**没有 boolean，没有靠 note 字符串区分语义**。

---

## 8. 还需要你拍板的若干设计选择

1. **`truncated` 是否尝试重试**（用更小的输入切片）还是直接 passthrough？我倾向后者——简单 + 用户调高 budget 即可。
2. **`distilled` 但 length ≥ ratio*original`** 是否单独一类（"compression-too-weak"）还是只在 `≥ original` 才报 blowup？
3. **`recall_impression` 重蒸馏是否拿 fresh content**（重新读文件 / 重新跑 tool）还是继续用 snapshot？后者简单但可能蒸馏过时内容。
4. **content 是否要先做长度截断再喂 LLM**？非常大的 toolResult 可能让 prompt 本身超出 context window。
5. **prompt 变体**（first/third person）是否合并成一个加 toggle 配置？
6. **`unknown` kind 是否要落 JSONL 一条 anomaly 记录**便于事后分析？还是只 notify？

逐条想一下，再告诉我。
