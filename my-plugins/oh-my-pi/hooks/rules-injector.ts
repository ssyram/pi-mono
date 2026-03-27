/**
 * Rules Injector Hook - Multi-directory rule scanning with glob matching and SHA dedup
 *
 * Scans rule files (.md, .mdc) from multiple directories:
 *   - {cwd}/.github/instructions/
 *   - {cwd}/.cursor/rules/
 *   - {cwd}/.claude/rules/
 *   - {cwd}/.sisyphus/rules/
 *   - ~/.claude/rules/ (global user rules)
 *
 * Supports YAML frontmatter for conditional injection:
 *   - alwaysApply: true  -> always inject
 *   - globs: "*.ts,*.tsx" -> inject when matching files referenced in context
 *   - paths / applyTo     -> aliases for globs (merged together)
 *   - no frontmatter     -> treated as alwaysApply
 *
 * SHA-256 content hashing prevents duplicate injection across directories.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, matchesGlob as nodeMatchesGlob } from "node:path";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  SessionStartEvent,
} from "@mariozechner/pi-coding-agent";
import type { OhMyPiConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuleMetadata {
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
}

interface ParsedRule {
  /** Display name (filename without extension) */
  name: string;
  /** Rule body (frontmatter stripped) */
  body: string;
  /** Parsed frontmatter */
  metadata: RuleMetadata;
  /** SHA-256 hex of body */
  hash: string;
  /** Source directory label */
  source: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RULE_LINES = 2000;

const RULE_EXTENSIONS = [".md", ".mdc"];

/** Project-level rule directories, scanned in order. */
const PROJECT_RULE_DIRS: readonly [string, string][] = [
  [".github", "instructions"],
  [".cursor", "rules"],
  [".claude", "rules"],
  [".sisyphus", "rules"],
];

/** Global user rule directory (relative to homedir). */
const USER_RULE_DIR = join(".claude", "rules");

// ---------------------------------------------------------------------------
// SHA-256 dedup state (module-level, cleared on session_start)
// ---------------------------------------------------------------------------

const injectedHashes = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Glob matching using Node.js built-in `path.matchesGlob` (available since v21.9).
 *
 * Supports negation patterns: "!*.test.ts" matches files that do NOT match "*.test.ts".
 */
function matchesGlob(filename: string, pattern: string): boolean {
  // Negation: !pattern -> true when the positive pattern does NOT match
  if (pattern.startsWith("!")) {
    return !matchesGlob(filename, pattern.slice(1));
  }

  return nodeMatchesGlob(filename, pattern);
}

/**
 * Extract file paths referenced in the system prompt.
 * Looks for common patterns: `/path/to/file.ext`, tool call arguments, etc.
 */
function extractReferencedFiles(systemPrompt: string): string[] {
  const filePattern = /(?:^|[\s"'`(,])([^\s"'`),]+\.\w{1,10})(?=[\s"'`),]|$)/gm;
  const files: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = filePattern.exec(systemPrompt)) !== null) {
    const candidate = match[1];
    // Filter out URLs and very short matches
    if (
      candidate &&
      !candidate.startsWith("http") &&
      !candidate.startsWith("//") &&
      candidate.length > 2
    ) {
      files.push(candidate);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (simple YAML, no deps)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { metadata: RuleMetadata; body: string } {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = raw.match(fmRegex);
  if (!match) {
    return { metadata: {}, body: raw };
  }

  const yamlContent = match[1];
  const body = match[2];

  try {
    const metadata = parseSimpleYaml(yamlContent);
    return { metadata, body };
  } catch {
    return { metadata: {}, body: raw };
  }
}

function parseSimpleYaml(yaml: string): RuleMetadata {
  const lines = yaml.split("\n");
  const metadata: RuleMetadata = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (key === "description") {
      metadata.description = stripQuotes(rawValue);
    } else if (key === "alwaysApply") {
      metadata.alwaysApply = rawValue === "true";
    } else if (key === "globs" || key === "paths" || key === "applyTo") {
      const parsed = parseGlobsValue(rawValue, lines, i);
      // Merge into globs (paths/applyTo are aliases)
      metadata.globs = [...(metadata.globs ?? []), ...parsed];
      // Skip consumed array lines
      if (!rawValue || rawValue === "") {
        i++;
        while (i < lines.length && /^\s+-\s/.test(lines[i])) {
          i++;
        }
        continue;
      }
    }

    i++;
  }

  return metadata;
}

function parseGlobsValue(rawValue: string, lines: string[], currentIdx: number): string[] {
  // Inline array: ["*.ts", "*.tsx"]
  if (rawValue.startsWith("[")) {
    const content = rawValue.slice(1, rawValue.lastIndexOf("]"));
    return content
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s.length > 0);
  }

  // Multi-line array
  if (!rawValue || rawValue === "") {
    const items: string[] = [];
    for (let j = currentIdx + 1; j < lines.length; j++) {
      const arrayMatch = lines[j].match(/^\s+-\s*(.+)$/);
      if (arrayMatch) {
        items.push(stripQuotes(arrayMatch[1].trim()));
      } else if (lines[j].trim() === "") {
        continue;
      } else {
        break;
      }
    }
    return items;
  }

  // Comma-separated string: "*.ts,*.tsx" or "*.ts, *.tsx"
  const str = stripQuotes(rawValue);
  if (str.includes(",")) {
    return str
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Single value
  return str ? [str] : [];
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

async function scanRuleDir(
  dir: string,
  sourceLabel: string,
): Promise<ParsedRule[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    const ruleFiles = entries.filter((f) =>
      RULE_EXTENSIONS.some((ext) => f.endsWith(ext)),
    );

    const rules: ParsedRule[] = [];
    for (const file of ruleFiles) {
      try {
        let raw = await readFile(join(dir, file), "utf-8");

        // Truncation protection
        const lineCount = raw.split("\n").length;
        if (lineCount > MAX_RULE_LINES) {
          const truncated = raw.split("\n").slice(0, MAX_RULE_LINES).join("\n");
          raw = truncated + "\n\n[truncated: original had " + lineCount + " lines]";
        }

        const { metadata, body } = parseFrontmatter(raw);
        const hash = sha256(body);
        const name = basename(file).replace(/\.(md|mdc)$/, "");

        rules.push({ name, body, metadata, hash, source: sourceLabel });
      } catch {
        // Skip unreadable files
      }
    }
    return rules;
  } catch {
    // Directory doesn't exist or unreadable
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rule applicability
// ---------------------------------------------------------------------------

function shouldApply(
  rule: ParsedRule,
  referencedFiles: string[],
): boolean {
  const { metadata } = rule;

  // No frontmatter -> always apply
  if (!metadata.globs && metadata.alwaysApply === undefined) {
    return true;
  }

  // Explicit alwaysApply
  if (metadata.alwaysApply === true) {
    return true;
  }

  // Glob matching against referenced files
  if (metadata.globs && metadata.globs.length > 0) {
    for (const refFile of referencedFiles) {
      for (const pattern of metadata.globs) {
        if (matchesGlob(refFile, pattern)) {
          return true;
        }
      }
    }
    // Has globs but nothing matched -> skip
    return false;
  }

  // alwaysApply: false with no globs -> skip
  if (metadata.alwaysApply === false) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerRulesInjector(
  pi: ExtensionAPI,
  config: OhMyPiConfig,
): void {
  // Clear dedup set on session start
  pi.on("session_start", (_event: SessionStartEvent) => {
    injectedHashes.clear();
    return undefined;
  });

  pi.on(
    "before_agent_start",
    async (event: BeforeAgentStartEvent, ctx) => {
      try {
        if (config.sisyphus_rules_enabled === false) return undefined;

        const cwd = ctx.cwd;
        const home = homedir();

        // 1. Scan all rule directories in parallel
        const scanTasks: Promise<ParsedRule[]>[] = [];
        for (const [parent, subdir] of PROJECT_RULE_DIRS) {
          const dir = join(cwd, parent, subdir);
          const label = `${parent}/${subdir}`;
          scanTasks.push(scanRuleDir(dir, label));
        }
        // Global user rules
        scanTasks.push(scanRuleDir(join(home, USER_RULE_DIR), "~/.claude/rules"));

        const allBatches = await Promise.all(scanTasks);
        const allRules = allBatches.flat();

        if (allRules.length === 0) return undefined;

        // 2. Extract referenced files from system prompt for glob matching
        const referencedFiles = extractReferencedFiles(event.systemPrompt);

        // 3. Filter: applicability + SHA dedup
        const applicable: ParsedRule[] = [];
        for (const rule of allRules) {
          // SHA dedup
          if (injectedHashes.has(rule.hash)) continue;

          // Applicability check
          if (!shouldApply(rule, referencedFiles)) continue;

          injectedHashes.add(rule.hash);
          applicable.push(rule);
        }

        if (applicable.length === 0) return undefined;

        // 4. Format injection block
        const rulesContent = applicable
          .map(
            (rule) =>
              `### ${rule.name} <sub>(${rule.source})</sub>\n\n${rule.body}`,
          )
          .join("\n\n");

        const injection = [
          "",
          "## Project Rules",
          "",
          rulesContent,
        ].join("\n");

        return {
          systemPrompt: event.systemPrompt + injection,
        };
      } catch {
        // Hooks must never throw
        return undefined;
      }
    },
  );
}
