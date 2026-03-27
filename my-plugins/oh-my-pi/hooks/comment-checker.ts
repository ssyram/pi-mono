/**
 * Comment Checker Hook - Real-time detection of lazy placeholder comments.
 *
 * Intercepts every Edit/Write tool result and scans the written content
 * for common shorthand patterns that indicate incomplete code:
 * - "// rest of code..."
 * - "// ... existing code"
 * - "/* TODO *​/"
 * - "// implementation here"
 * - "// ... (rest remains the same)"
 * - "// remaining code..."
 * - "// ... keep existing ..."
 * - "// placeholder"
 * - "/* ... *​/" (empty block comment)
 * - etc.
 *
 * Detection strategy (ordered by priority):
 * 1. AST-based: Uses @code-yeongyu/comment-checker (tree-sitter) to extract
 *    real comment nodes, then filters with lazy-content patterns. This avoids
 *    false positives from string literals containing comment-like text.
 * 2. Regex fallback: Scans raw text when the binary is unavailable.
 *
 * The binary availability is probed once at startup and cached.
 *
 * When detected, injects a warning directly into the tool result so the
 * agent sees it immediately -- no need to wait for the next turn.
 */

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

async function resolveCommentCheckerBinary(): Promise<string | null> {
  if (binaryPathCache !== undefined) {
    return binaryPathCache === false ? null : binaryPathCache;
  }

  try {
    const { execSync } = await import("node:child_process");

    // Strategy 1: globally installed or in PATH
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
    } catch {
      // not in PATH
    }

    // Strategy 2: resolve through the npm package
    try {
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");

      // Try common install locations
      const candidates = [
        // global npm
        join(process.env["HOME"] ?? "", ".npm", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker"),
        // npx cache or local node_modules
        ...(() => {
          try {
            const resolved = execSync(
              "node -e \"try{console.log(require.resolve('@code-yeongyu/comment-checker'))}catch{process.exit(1)}\"",
              { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] },
            ).trim();
            if (resolved) {
              const pkgDir = join(resolved, "..");
              return [join(pkgDir, "bin", "comment-checker")];
            }
          } catch {
            // ignore
          }
          return [];
        })(),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          binaryPathCache = candidate;
          return candidate;
        }
      }
    } catch {
      // resolve failed
    }

    binaryPathCache = false;
    return null;
  } catch {
    binaryPathCache = false;
    return null;
  }
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
    const oldText = input["oldText"];
    const newText = input["newText"];
    if (typeof path !== "string" || typeof newText !== "string") return null;
    return {
      session_id: "pi-hook",
      tool_name: "Edit",
      tool_input: {
        file_path: path,
        old_string: typeof oldText === "string" ? oldText : "",
        new_string: newText,
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
    const { execSync } = await import("node:child_process");

    const inputJson = JSON.stringify(hookInput);
    // Use a temp file to avoid shell escaping issues with complex code content
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

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
          // unexpected error (timeout, crash, etc.)
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
      } catch {
        // cleanup best-effort
      }
    }
  } catch {
    return null;
  }
}

// ─── Regex fallback detection ──────────────────────────────────────────────

function checkForLazyCommentsRegex(text: string): boolean {
  return REGEX_FALLBACK_PATTERNS.some((pattern) => pattern.test(text));
}

function extractWrittenText(event: ToolResultEvent): string | undefined {
  const input = event.input as Record<string, unknown>;

  if (event.toolName === "edit") {
    const newText = input["newText"];
    return typeof newText === "string" ? newText : undefined;
  }

  if (event.toolName === "write") {
    const content = input["content"];
    return typeof content === "string" ? content : undefined;
  }

  return undefined;
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerCommentChecker(pi: ExtensionAPI): void {
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
      } catch {
        return undefined;
      }
    },
  );
}
