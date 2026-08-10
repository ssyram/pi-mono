export interface RuleMetadata {
	description?: string;
	globs?: string[];
	alwaysApply?: boolean;
}

export interface ParsedRule {
	name: string;
	body: string;
	metadata: RuleMetadata;
	hash: string;
	source: string;
}
