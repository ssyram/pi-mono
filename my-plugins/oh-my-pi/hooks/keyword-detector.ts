/**
 * Keyword Detector Hook — detects ultrawork/search/analyze keywords in user messages.
 *
 * Ported from oh-my-opencode keyword-detector with tool-name adaptations for pi.
 *
 * Session filtering:
 * - Sub-agent sessions (prefixed with [AGENT:]) → only ultrawork passes through
 * - Main session → all keywords (ultrawork, search, analyze) pass through
 * - Planner agents → ultrawork is filtered out
 */

import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { getUltraworkMessage } from "./ultrawork/resolve.js";

// ─── Code block stripping ────────────────────────────────────────────────────

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

// ─── Keyword patterns ───────────────────────────────────────────────────────

const ULTRAWORK_PATTERN = /\b(ultrawork|ulw)\b/i;

/**
 * Search pattern — triggers search-mode across multiple languages.
 * - English: search, find, locate, lookup, explore, discover, scan, grep, query, browse,
 *            detect, trace, seek, track, pinpoint, hunt, where is, show me, list all
 * - Korean: 검색, 찾아, 탐색, 조회, 스캔, 서치, 뒤져, 찾기, 어디, 추적, 탐지, 찾아봐, 찾아내, 보여줘, 목록
 * - Japanese: 検索, 探して, 見つけて, サーチ, 探索, スキャン, どこ, 発見, 捜索, 見つけ出す, 一覧
 * - Chinese: 搜索, 查找, 寻找, 查询, 检索, 定位, 扫描, 发现, 在哪里, 找出来, 列出
 * - Vietnamese: tìm kiếm, tra cứu, định vị, quét, phát hiện, truy tìm, tìm ra, ở đâu, liệt kê
 */
const SEARCH_PATTERN =
  /\b(search|find|locate|lookup|look\s*up|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all|검색|찾아|탐색|조회|스캔|서치|뒤져|찾기|어디|추적|탐지|찾아봐|찾아내|보여줘|목록|検索|探して|見つけて|サーチ|探索|スキャン|どこ|発見|捜索|見つけ出す|一覧|搜索|查找|寻找|查询|检索|定位|扫描|发现|在哪里|找出来|列出|tìm kiếm|tra cứu|định vị|quét|phát hiện|truy tìm|tìm ra|ở đâu|liệt kê/i;

/**
 * Analyze pattern — triggers analyze-mode across multiple languages.
 * - English: analyze, analyse, investigate, examine, research, study, deep-dive, inspect,
 *            audit, evaluate, assess, review, diagnose, scrutinize, dissect, debug,
 *            comprehend, interpret, breakdown, understand, why is, how does, how to
 * - Korean: 분석, 조사, 파악, 연구, 검토, 진단, 이해, 설명, 원인, 이유, 뜯어봐, 따져봐, 평가, 해석, 디버깅, 디버그, 어떻게, 왜, 살펴
 * - Japanese: 分析, 調査, 解析, 検討, 研究, 診断, 理解, 説明, 検証, 精査, 究明, デバッグ, なぜ, どう, 仕組み
 * - Chinese: 调查, 检查, 剖析, 深入, 诊断, 解释, 调试, 为什么, 原理, 搞清楚, 弄明白
 * - Vietnamese: phân tích, điều tra, nghiên cứu, kiểm tra, xem xét, chẩn đoán, giải thích, tìm hiểu, gỡ lỗi, tại sao
 */
const ANALYZE_PATTERN =
  /\b(analyze|analyse|investigate|examine|research|study|deep[\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to|분석|조사|파악|연구|검토|진단|이해|설명|원인|이유|뜯어봐|따져봐|평가|해석|디버깅|디버그|어떻게|왜|살펴|分析|調査|解析|検討|研究|診断|理解|説明|検証|精査|究明|デバッグ|なぜ|どう|仕組み|调查|检查|剖析|深入|诊断|解释|调试|为什么|原理|搞清楚|弄明白|phân tích|điều tra|nghiên cứu|kiểm tra|xem xét|chẩn đoán|giải thích|tìm hiểu|gỡ lỗi|tại sao/i;

// ─── Injection messages ──────────────────────────────────────────────────────

const SEARCH_MESSAGE = `[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
- explore agents (codebase patterns, file structures, ast-grep)
- librarian agents (remote repos, official docs, GitHub examples)
Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)
NEVER stop at first result - be exhaustive.

AGENT DISPATCH:
\`\`\`
delegate_task(agent="explore", prompt="Find all occurrences of [PATTERN] in the codebase — file paths, usage patterns, and surrounding context. Be exhaustive. Search src/, packages/, and config files.")
delegate_task(agent="librarian", prompt="Find official documentation and real-world examples for [TOPIC]. Include API references, configuration guides, and common patterns from production codebases.")
\`\`\`

DIRECT TOOLS (use in parallel with agents):
- Grep for text/regex patterns
- ast_grep for structural code patterns
- Read files for targeted inspection

SYNTHESIZE all findings before reporting. Cross-reference agent results with direct tool output.`;

const ANALYZE_MESSAGE = `[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- 1-2 explore agents (codebase patterns, implementations)
- 1-2 librarian agents (if external library involved)
- Direct tools: Grep, AST-grep for targeted searches

\`\`\`
delegate_task(agent="explore", prompt="Find all implementations related to [TOPIC] — show file paths, architecture patterns, data flow, and dependencies. Map the full dependency graph.")
delegate_task(agent="librarian", prompt="Find authoritative references for [TECHNOLOGY/CONCEPT]. Include architecture guides, best practices, and known pitfalls from official docs.")
\`\`\`

IF COMPLEX - DO NOT STRUGGLE ALONE. Consult specialists:
- **Oracle**: Conventional problems (architecture, debugging, complex logic)
  \`call_agent(agent="oracle", prompt="Analyze [PROBLEM]. Evaluate approach, identify risks, suggest alternatives.")\`
- **Artistry**: Non-conventional problems (different approach needed)
  \`call_agent(category="artistry", prompt="This problem needs a creative approach: [DESCRIBE CONSTRAINTS].")\`

SYNTHESIZE findings before proceeding.`;


// ─── Keyword rules ───────────────────────────────────────────────────────────

type KeywordType = "ultrawork" | "search" | "analyze";

interface KeywordRule {
  type: KeywordType;
  pattern: RegExp;
  message: string | ((modelId?: string) => string);
}

const KEYWORD_RULES: KeywordRule[] = [
  { type: "ultrawork", pattern: ULTRAWORK_PATTERN, message: getUltraworkMessage },
  { type: "search", pattern: SEARCH_PATTERN, message: SEARCH_MESSAGE },
  { type: "analyze", pattern: ANALYZE_PATTERN, message: ANALYZE_MESSAGE },
];

// ─── Detection logic ─────────────────────────────────────────────────────────

interface DetectedKeyword {
  type: KeywordType;
  message: string;
}

function detectKeywords(text: string, modelId?: string): DetectedKeyword[] {
  const cleaned = removeCodeBlocks(text);
  return KEYWORD_RULES
    .filter((rule) => rule.pattern.test(cleaned))
    .map((rule) => ({
      type: rule.type,
      message: typeof rule.message === "function" ? rule.message(modelId) : rule.message,
    }));
}

// ─── Hook registration ──────────────────────────────────────────────────────

export function registerKeywordDetector(pi: ExtensionAPI): void {
  pi.on(
    "before_agent_start",
    async (event: BeforeAgentStartEvent, ctx) => {
      try {
        const agentPrompt = ctx.getSystemPrompt();
        const isSubAgent = agentPrompt.startsWith("[AGENT:");
        const isPlanner =
          agentPrompt.includes("PLANNER") ||
          agentPrompt.includes("Pre-Planning Consultant") ||
          agentPrompt.includes("Prometheus");

        const userMessage = event.prompt;
        if (!userMessage) return undefined;

        const modelId = ctx.model?.id;
        const detected = detectKeywords(userMessage, modelId);
        if (detected.length === 0) return undefined;

        // Sub-agent sessions: only ultrawork passes through
        // Planner sessions: ultrawork is filtered out
        const effective = detected.filter((d) => {
          if (isSubAgent && d.type !== "ultrawork") return false;
          if (isPlanner && d.type === "ultrawork") return false;
          return true;
        });
        if (effective.length === 0) return undefined;

        const injection = "\n\n" + effective.map((d) => d.message).join("\n\n");
        return { systemPrompt: event.systemPrompt + injection };
      } catch {
        return undefined;
      }
    },
  );
}
