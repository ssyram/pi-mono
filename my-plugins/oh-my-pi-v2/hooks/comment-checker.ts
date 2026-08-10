import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { checkCommentsWithAST } from "./comment-checker-ast.js";
import {
	createCommentCheckerBinaryResolver,
	type CommentCheckerBinaryResolver,
} from "./comment-checker-binary.js";
import { extractWrittenText } from "./comment-checker-input.js";
import { buildCommentWarning } from "./comment-checker-patterns.js";

export function registerCommentChecker(pi: ExtensionAPI): void {
	const resolvers = new WeakMap<ExtensionContext["sessionManager"], CommentCheckerBinaryResolver>();
	const resolverFor = (context: ExtensionContext): CommentCheckerBinaryResolver => {
		const existing = resolvers.get(context.sessionManager);
		if (existing) return existing;
		const created = createCommentCheckerBinaryResolver();
		resolvers.set(context.sessionManager, created);
		return created;
	};
	pi.on("session_start", (_event, context) => {
		resolvers.set(context.sessionManager, createCommentCheckerBinaryResolver());
	});
	pi.on("session_shutdown", (_event, context) => {
		resolvers.delete(context.sessionManager);
	});
	pi.on("tool_result", async (event: ToolResultEvent, context) => {
		try {
			if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
			if (event.isError || !extractWrittenText(event)) return undefined;
			const binaryPath = await resolverFor(context).resolve();
			if (!binaryPath) return undefined;
			const result = await checkCommentsWithAST(event, binaryPath);
			if (!result?.detected) return undefined;
			return {
				content: [
					...event.content,
					{ type: "text" as const, text: buildCommentWarning(result.matches) },
				],
			};
		} catch (error) {
			console.error(
				`[oh-my-pi comments] Comment checker hook failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	});
}
