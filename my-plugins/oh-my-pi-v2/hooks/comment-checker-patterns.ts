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

const WARNING = [
	"",
	"## WARNING: Placeholder Comments Detected",
	"",
	"You wrote placeholder/lazy comments in this edit. These are NOT acceptable.",
	"Go back and replace them with the actual, complete implementation code.",
	'Never use shorthand comments like "// rest of code..." or "// implementation here".',
	"Every line of code must be explicitly written out.",
].join("\n");

export interface ASTComment {
	line: number;
	text: string;
}

export function buildCommentWarning(matches: readonly ASTComment[]): string {
	if (matches.length === 0) return WARNING;
	const details = matches.map((match) => `  L${match.line}: ${match.text}`).join("\n");
	return `${WARNING}\n\nDetected at:\n${details}`;
}

function stripCommentDelimiter(raw: string): string {
	const text = raw.trim();
	if (text.startsWith("//")) return text.slice(2).trim();
	if (text.startsWith("/*") && text.endsWith("*/")) return text.slice(2, -2).trim();
	if (text.startsWith("#")) return text.slice(1).trim();
	return text;
}

export function parseLazyComments(stderr: string): ASTComment[] {
	const results: ASTComment[] = [];
	const seen = new Set<string>();
	const commentRegex = /<comment line-number="(\d+)">([\s\S]*?)<\/comment>/g;
	let match: RegExpExecArray | null;
	while ((match = commentRegex.exec(stderr)) !== null) {
		const line = Number.parseInt(match[1], 10);
		const text = match[2];
		const key = `${line}:${text}`;
		if (seen.has(key) || !LAZY_CONTENT_PATTERNS.some((pattern) => pattern.test(stripCommentDelimiter(text)))) {
			continue;
		}
		seen.add(key);
		results.push({ line, text });
	}
	return results;
}
