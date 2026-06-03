const DEFAULT_LLM_INPUT_MAX_CHARS = 10_240;

function parseMaxChars(value: boolean | string | undefined): number {
	if (typeof value !== "string") return DEFAULT_LLM_INPUT_MAX_CHARS;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LLM_INPUT_MAX_CHARS;
	return parsed;
}

function boundLlmInput(text: string, maxChars: number): { text: string; truncated: boolean; originalLength: number } {
	if (text.length <= maxChars) {
		return { text, truncated: false, originalLength: text.length };
	}

	return {
		text: text.slice(0, maxChars),
		truncated: true,
		originalLength: text.length,
	};
}

function formatTruncationNotice(originalLength: number, maxChars: number): string {
	return `[Input truncated from ${originalLength} to ${maxChars} characters.]`;
}

export { boundLlmInput, DEFAULT_LLM_INPUT_MAX_CHARS, formatTruncationNotice, parseMaxChars };
