import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

export interface CommentCheckerHookInput {
	session_id: string;
	tool_name: string;
	tool_input: Record<string, unknown>;
}

export function buildCommentCheckerHookInput(event: ToolResultEvent): CommentCheckerHookInput | undefined {
	const input = event.input as Record<string, unknown>;
	if (event.toolName === "edit") {
		const path = input.path;
		const edits = input.edits;
		if (typeof path !== "string" || !Array.isArray(edits) || edits.length === 0) return undefined;
		const allNewText = edits
			.map((edit) => {
				const newText = (edit as Record<string, unknown>).newText;
				return typeof newText === "string" ? newText : "";
			})
			.filter(Boolean)
			.join("\n");
		if (!allNewText) return undefined;
		const firstEdit = edits[0] as Record<string, unknown>;
		return {
			session_id: "pi-hook",
			tool_name: "Edit",
			tool_input: {
				file_path: path,
				old_string: typeof firstEdit.oldText === "string" ? firstEdit.oldText : "",
				new_string: allNewText,
			},
		};
	}
	if (event.toolName !== "write") return undefined;
	const path = input.path;
	const content = input.content;
	if (typeof path !== "string" || typeof content !== "string") return undefined;
	return {
		session_id: "pi-hook",
		tool_name: "Write",
		tool_input: { file_path: path, content },
	};
}

export function extractWrittenText(event: ToolResultEvent): string | undefined {
	const input = event.input as Record<string, unknown>;
	if (event.toolName === "edit") {
		const edits = input.edits;
		if (!Array.isArray(edits)) return undefined;
		const texts = edits
			.map((edit) => {
				const newText = (edit as Record<string, unknown>).newText;
				return typeof newText === "string" ? newText : "";
			})
			.filter(Boolean);
		return texts.length > 0 ? texts.join("\n") : undefined;
	}
	if (event.toolName !== "write") return undefined;
	return typeof input.content === "string" ? input.content : undefined;
}
