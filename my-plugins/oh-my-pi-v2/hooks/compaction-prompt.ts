export const COMPACTION_SYSTEM_PROMPT =
	"You are a context summarization assistant. " +
	"Your task is to read a conversation between a user and an AI coding assistant, " +
	"then produce a structured summary following the exact format specified.\n\n" +
	"Do NOT continue the conversation. Do NOT respond to any questions in the conversation. " +
	"ONLY output the structured summary.";

const COMPACTION_PROMPT = `Summarize the conversation above into a structured context summary. You MUST include ALL of the following sections:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Key code snippets, function signatures, or data structures under active development
- **External References**: Documentation URLs, library APIs, or external resources being consulted
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. Explicit Constraints (Verbatim Only)
- Include ONLY constraints explicitly stated by the user or in existing AGENTS.md context
- Quote constraints verbatim (do not paraphrase)
- Do NOT invent, add, or modify constraints
- If no explicit constraints exist, write "None"

## 7. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents (momus, oracle) to maintain continuity.

This context is critical for maintaining continuity after compaction.`;

const UPDATE_COMPACTION_PROMPT =
	"You are updating a previous context summary with new information from the latest conversation segment.\n\n" +
	"RULES:\n" +
	"- PRESERVE all existing information from the previous summary unless explicitly superseded\n" +
	"- ADD new progress, decisions, and context from the new conversation\n" +
	"- UPDATE the progress section to reflect current state\n" +
	"- PRESERVE exact file paths, variable names, and error messages\n" +
	"- Follow the same 7-section structure\n\n" +
	COMPACTION_PROMPT;

export function buildCompactionPrompt(
	conversationText: string,
	taskContext: string,
	customInstructions?: string,
): string {
	let prompt = `<conversation>\n${conversationText}\n</conversation>`;
	prompt += taskContext;
	prompt += `\n\n${COMPACTION_PROMPT}`;
	if (customInstructions) prompt += `\n\nAdditional focus: ${customInstructions}`;
	return prompt;
}

export function buildUpdateCompactionPrompt(
	conversationText: string,
	previousSummary: string,
	taskContext: string,
	customInstructions?: string,
): string {
	let prompt = `<conversation>\n${conversationText}\n</conversation>`;
	prompt += `\n\n<previous-summary>\n${previousSummary}\n</previous-summary>`;
	prompt += taskContext;
	prompt += `\n\n${UPDATE_COMPACTION_PROMPT}`;
	if (customInstructions) prompt += `\n\nAdditional focus: ${customInstructions}`;
	return prompt;
}
