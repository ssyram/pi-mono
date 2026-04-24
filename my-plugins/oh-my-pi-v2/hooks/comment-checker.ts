/**
 * Comment Checker Hook - Real-time detection of lazy placeholder comments.
 *
 * Intercepts every Edit/Write tool result and scans the written content
 * for common shorthand patterns that indicate incomplete code.
 */

import { execSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";

// ─── Lazy comment content patterns ─────────────────────────────────────────
// These match the *content* of a comment (text after stripping the comment
// delimiter like // or /* */). Used by the AST path. The regex-fallback path
// wraps them with delimiter matchers automatically.

const LAZY_CONTENT_PATTERNS: RegExp[] = [
  /rest of code/i,
  /\.{2,}\s*existing code/i,
  /^TODO$/i,
  /implementation here/i,
  /\.{2,}\s*\(rest remains the same\)/i,
  /Add more as needed/i,
  /^\.{3}\s*$/,
  /rest remains/i,
  /same as before/i,
  /\.{2,}\s*remaining/i,
  /remaining code/i,
  /\.{2,}\s*keep existing/i,
  /^\s*unchanged\s*$/i,
  /TODO:\s*implement/i,
  /^\s*placeholder\s*$/i,
  /add implementation/i,
  /^\s*\.{3}\s*$/,
];

// ─── Regex-fallback patterns ───────────────────────────────────────────────
// Full-line patterns that include the comment delimiter. Used when the AST
// binary is not available and we must scan raw text.

const REGEX_FALLBACK_PATTERNS: RegExp[] = [
  /\/\/\s*rest of code/i,
  /\/\/\s*\.{2,}\s*existing code/i,
  /\/\*\s*TODO\s*\*\//i,
  /\/\/\s*TODO\b/i,
  /\/\/\s*implementation here/i,
  /\/\/\s*\.{2,}\s*\(rest remains the same\)/i,
  /\/\/\s*Add more as needed/i,
  /\/\/\s*\.{3}\s*$/m,
  /\/\/\s*rest remains/i,
  /\/\/\s*same as before/i,
  /\/\/\s*\.{2,}\s*remaining/i,
  /\/\/\s*remaining code/i,
  /\/\/\s*\.{2,}\s*keep existing/i,
  /\/\/\s*unchanged/i,
  /\/\/\s*TODO:\s*implement/i,
  /\/\/\s*placeholder/i,
  /\/\/\s*add implementation/i,
  /\/\*\s*\.\.\.\s*\*\//,
  // Hash-style comments (Python, Ruby, Shell)
  /#\s*rest of code/i,
  /#\s*\.{2,}\s*existing code/i,
  /#\s*implementation here/i,
  /#\s*remaining code/i,
  /#\s*placeholder/i,
  /#\s*TODO:\s*implement/i,
  /#\s*add implementation/i,
  /#\s*TODO\b/i,
  /#\s*\.{2,}\s*\(rest remains the same\)/i,
  /#\s*Add more as needed/i,
  /#\s*\.{3}\s*$/m,
  /#\s*rest remains/i,
  /#\s*same as before/i,
  /#\s*\.{2,}\s*remaining/i,
  /#\s*\.{2,}\s*keep existing/i,
  /#\s*unchanged/i,
];

// ─── Warning message ────────────────────────────────────────────────────────

const WARNING = [
  "",
  "## WARNING: Placeholder Comments Detected",
  "",
  "You wrote placeholder/lazy comments in this edit. These are NOT acceptable.",
  "Go back and replace them with the actual, complete implementation code.",
  'Never use shorthand comments like "// rest of code..." or "// implementation here".',
  "Every line of code must be explicitly written out.",
].join("\n");

function buildWarningWithDetails(
  matches: ReadonlyArray<{ line: number; text: string }>,
): string {
  if (matches.length === 0) return WARNING;
  const details = matches
    .map((m) => `  L${m.line}: ${m.text}`)
    .join("\n");
  return `${WARNING}\n\nDetected at:\n${details}`;
}

// ─── AST binary resolution ─────────────────────────────────────────────────

let binaryPathCache: string | false | undefined;

/** Reset binary cache on session start so a newly-installed binary is picked up. */
export function resetBinaryCache(): void {
  binaryPathCache = undefined;
}

async function resolveCommentCheckerBinary(): Promise<string | null> {
  if (binaryPathCache !== undefined) {
    return binaryPathCache === false ? null : binaryPathCache;
  }

  try {
    const whichResult = execSync("which comment-checker", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (whichResult) {
      binaryPathCache = whichResult;
      return whichResult;
    }
  } catch (err) {
    console.error(`[oh-my-pi comments] comment-checker not found in PATH: ${err instanceof Error ? err.message : String(err)}`);
  }

  const candidates = [
    join(process.env["HOME"] ?? "", ".npm", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker"),
    ...resolveCommentCheckerPackageCandidates(),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      binaryPathCache = candidate;
      return candidate;
    }
  }

  binaryPathCache = false;
  return null;
}

function resolveCommentCheckerPackageCandidates(): string[] {
  try {
    const resolved = execSync(
      "node -e \"try{console.log(require.resolve('@code-yeongyu/comment-checker'))}catch{process.exit(1)}\"",
      { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (resolved) {
      const pkgDir = join(resolved, "..");
      return [join(pkgDir, "bin", "comment-checker")];
    }
  } catch (err) {
    console.error(`[oh-my-pi comments] Failed to resolve comment-checker npm package: ${err instanceof Error ? err.message : String(err)}`);
  }
  return [];
}

// ─── AST detection ─────────────────────────────────────────────────────────

interface ASTComment {
  line: number;
  text: string;
}

function parseCommentsFromStderr(stderr: string): ASTComment[] {
  const results: ASTComment[] = [];
  const seen = new Set<string>();

  const commentRegex = /<comment line-number="(\d+)">([\s\S]*?)<\/comment>/g;
  let match: RegExpExecArray | null;

  while ((match = commentRegex.exec(stderr)) !== null) {
    const line = parseInt(match[1], 10);
    const text = match[2];
    const key = `${line}:${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ line, text });
    }
  }

  return results;
}

function stripCommentDelimiter(raw: string): string {
  let s = raw.trim();

  // Line comment: // ...
  if (s.startsWith("//")) {
    return s.slice(2).trim();
  }

  // Block comment: /* ... */
  if (s.startsWith("/*") && s.endsWith("*/")) {
    return s.slice(2, -2).trim();
  }

  // Hash comment: # ...
  if (s.startsWith("#")) {
    return s.slice(1).trim();
  }

  return s;
}

function isLazyContent(stripped: string): boolean {
  return LAZY_CONTENT_PATTERNS.some((p) => p.test(stripped));
}

interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

function buildHookInput(event: ToolResultEvent): HookInput | null {
  const input = event.input as Record<string, unknown>;

  if (event.toolName === "edit") {
    const path = input["path"];
    if (typeof path !== "string") return null;

    // pi's edit tool normalizes input to { path, edits: [{oldText, newText}] }
    // via prepareEditArguments (edit.ts). We concatenate all newText values.
    const edits = input["edits"];
    if (!Array.isArray(edits) || edits.length === 0) return null;

    const allNewText = edits
      .map((e: unknown) => (typeof (e as Record<string, unknown>)?.["newText"] === "string" ? (e as Record<string, string>)["newText"] : ""))
      .filter(Boolean)
      .join("\n");
    if (!allNewText) return null;

    const firstEdit = edits[0] as Record<string, unknown>;
    return {
      session_id: "pi-hook",
      tool_name: "Edit",
      tool_input: {
        file_path: path,
        old_string: typeof firstEdit["oldText"] === "string" ? firstEdit["oldText"] : "",
        new_string: allNewText,
      },
    };
  }

  if (event.toolName === "write") {
    const path = input["path"];
    const content = input["content"];
    if (typeof path !== "string" || typeof content !== "string") return null;
    return {
      session_id: "pi-hook",
      tool_name: "Write",
      tool_input: {
        file_path: path,
        content,
      },
    };
  }

  return null;
}

async function checkWithAST(
  event: ToolResultEvent,
  binaryPath: string,
): Promise<{ detected: boolean; matches: ASTComment[] } | null> {
  const hookInput = buildHookInput(event);
  if (!hookInput) return null;

  try {
    const inputJson = JSON.stringify(hookInput);
    const tmpFile = join(tmpdir(), `pi-cc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

    try {
      writeFileSync(tmpFile, inputJson, "utf-8");

      let stderr: string;
      try {
        execSync(`"${binaryPath}" < "${tmpFile}"`, {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
          maxBuffer: 1024 * 1024,
        });
        // exit 0 => no comments detected
        return { detected: false, matches: [] };
      } catch (err: unknown) {
        const execErr = err as { status?: number; stderr?: string };
        if (execErr.status === 2 && typeof execErr.stderr === "string") {
          stderr = execErr.stderr;
        } else {
          const msg = execErr.stderr || (err instanceof Error ? err.message : String(err));
          console.error(`[oh-my-pi comments] Comment checker execution failed: ${msg}`);
          return null;
        }
      }

      // Parse AST-extracted comments
      const allComments = parseCommentsFromStderr(stderr);

      // Filter: only keep comments whose content matches lazy patterns
      const lazyMatches = allComments.filter((c) => {
        const stripped = stripCommentDelimiter(c.text);
        return isLazyContent(stripped);
      });

      return {
        detected: lazyMatches.length > 0,
        matches: lazyMatches,
      };
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch (err) {
        console.error(`[oh-my-pi comments] Failed to remove temp file ${tmpFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.error(`[oh-my-pi comments] AST comment check failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Regex fallback detection ──────────────────────────────────────────────

/**
 * Strip string literals from source code to prevent false positives.
 * Replaces content inside "..." and '...' with empty strings, handling escapes.
 * Template literals (`...`) are also handled.
 */
function stripStringLiterals(text: string): string {
  let i = 0;
  const len = text.length;

  // Skip a regular string ('' or ""), advancing i past the closing quote.
  // Returns nothing — content is discarded.
  function skipString(quote: string): void {
    i++; // skip opening quote
    while (i < len && text[i] !== quote) {
      if (text[i] === "\\") { i += 2; continue; }
      i++;
    }
    if (i < len) i++; // skip closing quote
  }

  // Skip a template literal (` ... `), recursively handling ${...} interpolations.
  // Content between backticks is discarded. Interpolation expressions are kept
  // (they may contain comment-like code that should be checked).
  function skipTemplateLiteral(): string {
    i++; // skip opening backtick
    let interpolated = "";
    while (i < len && text[i] !== "`") {
      if (text[i] === "\\" ) { i += 2; continue; }
      if (text[i] === "$" && i + 1 < len && text[i + 1] === "{") {
        i += 2; // skip ${
        interpolated += processInterpolation();
        continue;
      }
      i++; // skip template string character
    }
    if (i < len) i++; // skip closing backtick
    return interpolated;
  }

  // Process the inside of a ${...} interpolation (brace-delimited).
  // Returns the expression content (including any nested strings stripped).
  function processInterpolation(): string {
    let result = "";
    let depth = 1;
    while (i < len && depth > 0) {
      if (text[i] === "{") { depth++; result += text[i]; i++; }
      else if (text[i] === "}") { depth--; if (depth > 0) { result += text[i]; } i++; }
      else if (text[i] === '"' || text[i] === "'") { skipString(text[i]); }
      else if (text[i] === "`") { result += skipTemplateLiteral(); }
      else { result += text[i]; i++; }
    }
    return result;
  }

  // Main loop: copy non-string content, skip string literals
  let result = "";
  while (i < len) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      result += ch; // keep opening quote
      skipString(ch);
      result += ch; // keep closing quote (as empty string marker)
      continue;
    }
    if (ch === "`") {
      result += "`";
      result += skipTemplateLiteral();
      result += "`";
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

function checkForLazyCommentsRegex(text: string): boolean {
  // Strip string literals first to avoid matching comment-like patterns
  // inside strings (e.g., const url = "// rest of code").
  const stripped = stripStringLiterals(text);
  return REGEX_FALLBACK_PATTERNS.some((pattern) => pattern.test(stripped));
}

function extractWrittenText(event: ToolResultEvent): string | undefined {
  const input = event.input as Record<string, unknown>;

  if (event.toolName === "edit") {
    // pi normalizes edit input to { path, edits: [{oldText, newText}] }
    const edits = input["edits"];
    if (!Array.isArray(edits)) return undefined;
    const texts = edits
      .map((e: unknown) => {
        const newText = (e as Record<string, unknown>)?.["newText"];
        return typeof newText === "string" ? newText : "";
      })
      .filter(Boolean);
    return texts.length > 0 ? texts.join("\n") : undefined;
  }

  if (event.toolName === "write") {
    const content = input["content"];
    return typeof content === "string" ? content : undefined;
  }

  return undefined;
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerCommentChecker(pi: ExtensionAPI): void {
  // Re-probe binary on session start so a newly-installed checker is detected
  pi.on("session_start", async () => { resetBinaryCache(); });

  pi.on(
    "tool_result",
    async (event: ToolResultEvent) => {
      try {
        if (event.toolName !== "edit" && event.toolName !== "write") {
          return undefined;
        }

        if (event.isError) return undefined;

        const written = extractWrittenText(event);
        if (!written) return undefined;

        // Try AST-based detection first
        const binaryPath = await resolveCommentCheckerBinary();
        if (binaryPath) {
          const astResult = await checkWithAST(event, binaryPath);
          if (astResult !== null) {
            // AST detection succeeded (binary ran without unexpected error)
            if (!astResult.detected) return undefined;

            const appendedContent = [
              ...event.content,
              { type: "text" as const, text: buildWarningWithDetails(astResult.matches) },
            ];
            return { content: appendedContent };
          }
          // astResult === null means binary failed unexpectedly; fall through to regex
        }

        // Regex fallback
        if (!checkForLazyCommentsRegex(written)) return undefined;

        const appendedContent = [
          ...event.content,
          { type: "text" as const, text: WARNING },
        ];

        return { content: appendedContent };
      } catch (err) {
        console.error(`[oh-my-pi comments] Comment checker hook failed: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    },
  );
}
