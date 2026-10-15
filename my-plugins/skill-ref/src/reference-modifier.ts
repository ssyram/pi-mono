export const REFERENCE_OPERATIONS = ["print", "path"] as const;

export type ReferenceOperation = (typeof REFERENCE_OPERATIONS)[number];
export type ModifierSeparator = ":" | "::";

export interface ReferenceOccurrence {
	start: number;
	end: number;
	reference: string;
	/** Executed operation; null for a bare `\:` escape (pure literal-colon replacement). */
	operation: ReferenceOperation | null;
	escapeIndex: number | null;
}

export interface ModifierContext {
	reference: string;
	start: number;
	prefix: string;
	separator: ModifierSeparator;
	escaped: boolean;
	fragment: string;
}
