/**
 * Configuration management for oh-my-pi.
 * Loads JSONC config from project-level or user-level paths.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CategoryConfig {
	model: string;
	agent: string;
	description: string;
	fallbackModels?: string[];
	promptAppend?: string;
}

export interface OhMyPiConfig {
	categories?: Record<string, Partial<CategoryConfig>>;
	disabled_agents?: string[];
	default_model?: string;
	boulder_enabled?: boolean;
	sisyphus_rules_enabled?: boolean;
	max_concurrent_tasks?: number;
}

// ─── Category prompt appends ─────────────────────────────────────────────────

const VISUAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on VISUAL/UI tasks.

<DESIGN_SYSTEM_WORKFLOW_MANDATE>
## YOU ARE A VISUAL ENGINEER. FOLLOW THIS WORKFLOW OR YOUR OUTPUT IS REJECTED.

**YOUR FAILURE MODE**: You skip design system analysis and jump straight to writing components with hardcoded colors, arbitrary spacing, and ad-hoc font sizes. The result is INCONSISTENT GARBAGE that looks like 5 different people built it. THIS STOPS NOW.

**EVERY visual task follows this EXACT workflow. VIOLATION = BROKEN OUTPUT.**

### PHASE 1: ANALYZE THE DESIGN SYSTEM (MANDATORY FIRST ACTION)

**BEFORE writing a SINGLE line of CSS, HTML, JSX, Svelte, or component code — you MUST:**

1. **SEARCH for the design system.** Use Grep, Glob, Read — actually LOOK:
   - Design tokens: colors, spacing, typography, shadows, border-radii
   - Theme files: CSS variables, Tailwind config, \`theme.ts\`, styled-components theme, design tokens file
   - Shared/base components: Button, Card, Input, Layout primitives
   - Existing UI patterns: How are pages structured? What spacing grid? What color usage?

2. **READ at minimum 5-10 existing UI components.** Understand:
   - Naming conventions (BEM? Atomic? Utility-first? Component-scoped?)
   - Spacing system (4px grid? 8px? Tailwind scale? CSS variables?)
   - Color usage (semantic tokens? Direct hex? Theme references?)
   - Typography scale (heading levels, body, caption — how many? What font stack?)
   - Component composition patterns (slots? children? compound components?)

**DO NOT proceed to Phase 2 until you can answer ALL of these. If you cannot, you have not explored enough. EXPLORE MORE.**

### PHASE 2: NO DESIGN SYSTEM? BUILD ONE. NOW.

If Phase 1 reveals NO coherent design system (or scattered, inconsistent patterns):

1. **STOP. Do NOT build the requested UI yet.**
2. **Extract what exists** — even inconsistent patterns have salvageable decisions.
3. **Create a minimal design system FIRST:**
   - Color palette: primary, secondary, neutral, semantic (success/warning/error/info)
   - Typography scale: heading levels (h1-h4 minimum), body, small, caption
   - Spacing scale: consistent increments (4px or 8px base)
   - Border radii, shadows, transitions — systematic, not random
   - Component primitives: the reusable building blocks
4. **Commit/save the design system, THEN proceed to Phase 3.**

A design system is NOT optional overhead. It is the FOUNDATION. Building UI without one is like building a house on sand. It WILL collapse into inconsistency.

### PHASE 3: BUILD WITH THE SYSTEM. NEVER AROUND IT.

**NOW and ONLY NOW** — implement the requested visual work:

| Element | CORRECT | WRONG (WILL BE REJECTED) |
|---------|---------|--------------------------|
| Color | Design token / CSS variable | Hardcoded \`#3b82f6\`, \`rgb(59,130,246)\` |
| Spacing | System value (\`space-4\`, \`gap-md\`, \`var(--spacing-4)\`) | Arbitrary \`margin: 13px\`, \`padding: 7px\` |
| Typography | Scale value (\`text-lg\`, \`heading-2\`, token) | Ad-hoc \`font-size: 17px\` |
| Component | Extend/compose from existing primitives | One-off div soup with inline styles |
| Border radius | System token | Random \`border-radius: 6px\` |

**IF the design requires something OUTSIDE the current system:**
- **Extend the system FIRST** — add the new token/primitive
- **THEN use the new token** in your component
- **NEVER one-off override.** That is how design systems die.

### PHASE 4: VERIFY BEFORE CLAIMING DONE

BEFORE reporting visual work as complete, answer these:

- [ ] Does EVERY color reference a design token or CSS variable?
- [ ] Does EVERY spacing use the system scale?
- [ ] Does EVERY component follow the existing composition pattern?
- [ ] Would a designer see CONSISTENCY across old and new components?
- [ ] Are there ZERO hardcoded magic numbers for visual properties?

**If ANY answer is NO — FIX IT. You are NOT done.**

</DESIGN_SYSTEM_WORKFLOW_MANDATE>

<DESIGN_QUALITY>
Design-first mindset (AFTER design system is established):
- Bold aesthetic choices over safe defaults
- Unexpected layouts, asymmetry, grid-breaking elements
- Distinctive typography (avoid: Arial, Inter, Roboto, Space Grotesk)
- Cohesive color palettes with sharp accents
- High-impact animations with staggered reveals
- Atmosphere: gradient meshes, noise textures, layered transparencies

AVOID: Generic fonts, purple gradients on white, predictable layouts, cookie-cutter patterns.
</DESIGN_QUALITY>
</Category_Context>`;

const ULTRABRAIN_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on DEEP LOGICAL REASONING / COMPLEX ARCHITECTURE tasks.

**CRITICAL - CODE STYLE REQUIREMENTS (NON-NEGOTIABLE)**:
1. BEFORE writing ANY code, SEARCH the existing codebase to find similar patterns/styles
2. Your code MUST match the project's existing conventions - blend in seamlessly
3. Write READABLE code that humans can easily understand - no clever tricks
4. If unsure about style, explore more files until you find the pattern

Strategic advisor mindset:
- Bias toward simplicity: least complex solution that fulfills requirements
- Leverage existing code/patterns over new components
- Prioritize developer experience and maintainability
- One clear recommendation with effort estimate (Quick/Short/Medium/Large)
- Signal when advanced approach warranted

Response format:
- Bottom line (2-3 sentences)
- Action plan (numbered steps)
- Risks and mitigations (if relevant)
</Category_Context>`;

const ARTISTRY_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on HIGHLY CREATIVE / ARTISTIC tasks.

Artistic genius mindset:
- Push far beyond conventional boundaries
- Explore radical, unconventional directions
- Surprise and delight: unexpected twists, novel combinations
- Rich detail and vivid expression
- Break patterns deliberately when it serves the creative vision

Approach:
- Generate diverse, bold options first
- Embrace ambiguity and wild experimentation
- Balance novelty with coherence
- This is for tasks requiring exceptional creativity
</Category_Context>`;

const QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SMALL / QUICK tasks.

Efficient execution mindset:
- Fast, focused, minimal overhead
- Get to the point immediately
- No over-engineering
- Simple solutions for simple problems

Approach:
- Minimal viable implementation
- Skip unnecessary abstractions
- Direct and concise
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A SMALLER/FASTER MODEL (haiku-4-5).

The model executing this task is optimized for speed over depth. Your prompt MUST be:

**EXHAUSTIVELY EXPLICIT** - Leave NOTHING to interpretation:
1. MUST DO: List every required action as atomic, numbered steps
2. MUST NOT DO: Explicitly forbid likely mistakes and deviations
3. EXPECTED OUTPUT: Describe exact success criteria with concrete examples

**WHY THIS MATTERS:**
- Smaller models benefit from explicit guardrails
- Vague instructions may lead to unpredictable results
- Implicit expectations may be missed
**PROMPT STRUCTURE (MANDATORY):**
\`\`\`
TASK: [One-sentence goal]

MUST DO:
1. [Specific action with exact details]
2. [Another specific action]
...

MUST NOT DO:
- [Forbidden action + why]
- [Another forbidden action]
...

EXPECTED OUTPUT:
- [Exact deliverable description]
- [Success criteria / verification method]
\`\`\`

If your prompt lacks this structure, REWRITE IT before delegating.
</Caller_Warning>`;

const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.

<Selection_Gate>
BEFORE selecting this category, VERIFY ALL conditions:
1. Task does NOT fit: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires more than trivial effort but is NOT system-wide
3. Scope is contained within a few files/modules

If task fits ANY other category, DO NOT select unspecified-low.
This is NOT a default choice - it's for genuinely unclassifiable moderate-effort work.
</Selection_Gate>
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A MID-TIER MODEL (sonnet-4-6).

**PROVIDE CLEAR STRUCTURE:**
1. MUST DO: Enumerate required actions explicitly
2. MUST NOT DO: State forbidden actions to prevent scope creep
3. EXPECTED OUTPUT: Define concrete success criteria
</Caller_Warning>`;

const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.

<Selection_Gate>
BEFORE selecting this category, VERIFY ALL conditions:
1. Task does NOT fit: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires substantial effort across multiple systems/modules
3. Changes have broad impact or require careful coordination
4. NOT just "complex" - must be genuinely unclassifiable AND high-effort

If task fits ANY other category, DO NOT select unspecified-high.
If task is unclassifiable but moderate-effort, use unspecified-low instead.
</Selection_Gate>
</Category_Context>`;

const WRITING_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on WRITING / PROSE tasks.

Wordsmith mindset:
- Clear, flowing prose
- Appropriate tone and voice
- Engaging and readable
- Proper structure and organization

Approach:
- Understand the audience
- Draft with care
- Polish for clarity and impact
- Documentation, READMEs, articles, technical writing

ANTI-AI-SLOP RULES (NON-NEGOTIABLE):
- NEVER use em dashes (—) or en dashes (–). Use commas, periods, ellipses, or line breaks instead. Zero tolerance.
- Remove AI-sounding phrases: "delve", "it's important to note", "I'd be happy to", "certainly", "please don't hesitate", "leverage", "utilize", "in order to", "moving forward", "circle back", "at the end of the day", "robust", "streamline", "facilitate"
- Pick plain words. "Use" not "utilize". "Start" not "commence". "Help" not "facilitate".
- Use contractions naturally: "don't" not "do not", "it's" not "it is".
- Vary sentence length. Don't make every sentence the same length.
- NEVER start consecutive sentences with the same word.
- No filler openings: skip "In today's world...", "As we all know...", "It goes without saying..."
- Write like a human, not a corporate template.
</Category_Context>`;

const DEEP_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on GOAL-ORIENTED AUTONOMOUS tasks.

**CRITICAL - AUTONOMOUS EXECUTION MINDSET (NON-NEGOTIABLE)**:
You are NOT an interactive assistant. You are an autonomous problem-solver.

**BEFORE making ANY changes**:
1. SILENTLY explore the codebase extensively (5-15 minutes of reading is normal)
2. Read related files, trace dependencies, understand the full context
3. Build a complete mental model of the problem space
4. DO NOT ask clarifying questions - the goal is already defined

**Autonomous executor mindset**:
- You receive a GOAL. When the goal includes numbered steps or phases, treat them as one atomic task broken into sub-steps - NOT as separate independent tasks.
- Figure out HOW to achieve the goal yourself
- Thorough research before any action
- Fix hairy problems that require deep understanding
- Work independently without frequent check-ins

**Single vs. multi-step context**:
- Sub-steps of ONE goal (e.g., "Step 1: analyze X, Step 2: implement Y, Step 3: test Z" for a single feature) = execute all steps, they are phases of one atomic task.
- Genuinely independent tasks (e.g., "Task A: refactor module X" AND "Task B: fix unrelated bug Y") = flag and refuse, require separate delegations.

**Approach**:
- Explore extensively, understand deeply, then act decisively
- Prefer comprehensive solutions over quick patches
- If the goal is unclear, make reasonable assumptions and proceed
- Document your reasoning in code comments only when non-obvious

**Response format**:
- Minimal status updates (user trusts your autonomy)
- Focus on results, not play-by-play progress
- Report completion with summary of changes made
</Category_Context>`;

// ─── Default categories ──────────────────────────────────────────────────────

export const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = {
	"visual-engineering": {
		model: "sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Frontend/UI",
		fallbackModels: ["haiku-4-5"],
		promptAppend: VISUAL_CATEGORY_PROMPT_APPEND,
	},
	ultrabrain: {
		model: "opus-4-6",
		agent: "sisyphus-junior",
		description: "Hard logic",
		fallbackModels: ["sonnet-4-6"],
		promptAppend: ULTRABRAIN_CATEGORY_PROMPT_APPEND,
	},
	deep: {
		model: "sonnet-4-6",
		agent: "hephaestus",
		description: "Autonomous deep work",
		fallbackModels: ["haiku-4-5"],
		promptAppend: DEEP_CATEGORY_PROMPT_APPEND,
	},
	artistry: {
		model: "sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Creative design",
		fallbackModels: ["haiku-4-5"],
		promptAppend: ARTISTRY_CATEGORY_PROMPT_APPEND,
	},
	quick: {
		model: "haiku-4-5",
		agent: "sisyphus-junior",
		description: "Trivial tasks",
		fallbackModels: ["sonnet-4-6"],
		promptAppend: QUICK_CATEGORY_PROMPT_APPEND,
	},
	"unspecified-low": {
		model: "sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Medium effort",
		fallbackModels: ["haiku-4-5"],
		promptAppend: UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
	},
	"unspecified-high": {
		model: "opus-4-6",
		agent: "sisyphus-junior",
		description: "High effort",
		fallbackModels: ["sonnet-4-6"],
		promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
	},
	writing: {
		model: "sonnet-4-6",
		agent: "sisyphus-junior",
		description: "Documentation",
		fallbackModels: ["haiku-4-5"],
		promptAppend: WRITING_CATEGORY_PROMPT_APPEND,
	},
};

/**
 * Strip JSONC comments (// line comments and /* block comments) from a string,
 * being careful not to strip inside JSON string values.
 */
function stripJsoncComments(text: string): string {
	let result = "";
	let i = 0;
	const len = text.length;

	while (i < len) {
		// Handle string literals — pass through without stripping
		if (text[i] === '"') {
			result += '"';
			i++;
			while (i < len && text[i] !== '"') {
				if (text[i] === "\\") {
					result += text[i];
					i++;
					if (i < len) {
						result += text[i];
						i++;
					}
					continue;
				}
				result += text[i];
				i++;
			}
			if (i < len) {
				result += '"';
				i++;
			}
			continue;
		}

		// Line comment
		if (text[i] === "/" && i + 1 < len && text[i + 1] === "/") {
			// Skip until end of line
			i += 2;
			while (i < len && text[i] !== "\n") {
				i++;
			}
			continue;
		}

		// Block comment
		if (text[i] === "/" && i + 1 < len && text[i + 1] === "*") {
			i += 2;
			while (i < len && !(text[i] === "*" && i + 1 < len && text[i + 1] === "/")) {
				i++;
			}
			if (i < len) {
				i += 2; // skip closing */
			}
			continue;
		}

		result += text[i];
		i++;
	}

	return result;
}

/**
 * Parse a JSONC string into an object.
 */
function parseJsonc<T>(text: string): T {
	const stripped = stripJsoncComments(text);
	// Strip trailing commas before ] or } to tolerate JSONC-style trailing commas.
	// Known limitation: this regex doesn't respect string boundaries, so a string
	// value containing ",]" or ",}" would be incorrectly modified. This is acceptable
	// for config files where such string content is extremely unlikely.
	const cleaned = stripped.replace(/,\s*([\]}])/g, "$1");
	return JSON.parse(cleaned) as T;
}

/**
 * Try to read and parse a JSONC file; returns null if the file doesn't exist.
 */
async function tryLoadJsonc<T>(path: string): Promise<T | null> {
	try {
		const raw = await readFile(path, "utf-8");
		return parseJsonc<T>(raw);
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

/**
 * Load oh-my-pi config.
 * Loads user-level (~/.pi/oh-my-pi.jsonc) as base, then deep-merges
 * project-level (.pi/oh-my-pi.jsonc) on top. If neither exists, returns defaults.
 */
export async function loadConfig(cwd: string): Promise<OhMyPiConfig> {
	const userPath = join(homedir(), ".pi", "oh-my-pi.jsonc");
	const projectPath = join(cwd, ".pi", "oh-my-pi.jsonc");

	const userConfig = await tryLoadJsonc<OhMyPiConfig>(userPath) ?? {};
	const projectConfig = await tryLoadJsonc<OhMyPiConfig>(projectPath) ?? {};

	// Deep merge: project overrides user, per-category field merge
	const userCats = userConfig.categories ?? {};
	const projectCats = projectConfig.categories ?? {};
	const allCategoryKeys = new Set([...Object.keys(userCats), ...Object.keys(projectCats)]);
	const mergedCategories: Record<string, Partial<CategoryConfig>> = {};
	for (const key of allCategoryKeys) {
		mergedCategories[key] = { ...userCats[key], ...projectCats[key] };
	}

	return {
		...userConfig,
		...projectConfig,
		categories: mergedCategories,
		disabled_agents: [
			...new Set([...(userConfig.disabled_agents ?? []), ...(projectConfig.disabled_agents ?? [])]),
		],
	};
}

/**
 * Get a fully-resolved category config by name.
 * Merges user overrides on top of built-in defaults.
 */
export function getCategory(config: OhMyPiConfig, name: string): CategoryConfig | undefined {
	const builtin = DEFAULT_CATEGORIES[name];
	const override = config.categories?.[name];

	if (!builtin && !override) {
		return undefined;
	}

	if (!override) {
		return builtin;
	}

	// Merge: override fields win over builtin (or fallback to sensible defaults)
	return {
		model: override.model ?? builtin?.model ?? "sonnet-4-6",
		agent: override.agent ?? builtin?.agent ?? "sisyphus-junior",
		description: override.description ?? builtin?.description ?? name,
		fallbackModels: override.fallbackModels ?? builtin?.fallbackModels,
		promptAppend: override.promptAppend ?? builtin?.promptAppend,
	};
}
