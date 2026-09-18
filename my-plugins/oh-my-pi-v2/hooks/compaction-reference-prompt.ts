export function buildCompactionReferenceInstructions(): string {
	return `Optional exact-text references are available at existing positions in the previous summary and current user messages.
Continue writing free-form summary text; references are shortcuts, not mandatory selections. Summary text is not necessarily a user quote or independently verified fact.
A label such as @!1@ starts its source chunk. @!@ ends that independent document; text after it is not part of that source. Do not copy labels as final locators or output the ending marker.
Use @!1@ to insert that complete source, @!1[2:8]@ to select characters, @!1~3@ to join inclusive consecutive chunks of the SAME summary, or @!(1~3)[2:8]@ to slice that joined range. Use only labels actually displayed in this request.
Slices count Unicode characters (code points), start at zero, and exclude the end. Endpoints may be omitted or negative, counting from the end; out-of-bounds endpoints clamp. [2..8] is an alias for [2:8]. Empty or reversed slices produce empty text.
Each current pure-text user message is one whole independent source. Ranges cannot cross messages, document-ending markers, or unindexed content. Assistant messages, tool calls/results, file lists, task context and instructions have no reference labels.
To write a literal @! prefix, write @|!; preserve one additional pipe for already piped literals (literal @|! becomes @||!). References are expanded once after generation; invalid references become a neutral unresolved-reference notice.
Do not use methods, endpoint transforms, nested expressions or ungrouped range slices. Mix valid references with your own prose as needed.`;
}
