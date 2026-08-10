import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { buildCommentCheckerHookInput } from "./comment-checker-input.js";
import { parseLazyComments, type ASTComment } from "./comment-checker-patterns.js";

export interface CommentCheckResult {
	detected: boolean;
	matches: ASTComment[];
}

export async function checkCommentsWithAST(
	event: ToolResultEvent,
	binaryPath: string,
): Promise<CommentCheckResult | undefined> {
	const hookInput = buildCommentCheckerHookInput(event);
	if (!hookInput) return undefined;
	try {
		const temporaryFile = join(tmpdir(), `pi-cc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
		try {
			writeFileSync(temporaryFile, JSON.stringify(hookInput), "utf-8");
			let stderr: string;
			try {
				execSync(`"${binaryPath}" < "${temporaryFile}"`, {
					encoding: "utf-8",
					timeout: 5000,
					stdio: ["pipe", "pipe", "pipe"],
					maxBuffer: 1024 * 1024,
				});
				return { detected: false, matches: [] };
			} catch (error) {
				const executionError = error as { status?: number; stderr?: string };
				if (executionError.status !== 2 || typeof executionError.stderr !== "string") {
					const message = executionError.stderr || (error instanceof Error ? error.message : String(error));
					console.error(`[oh-my-pi comments] Comment checker execution failed: ${message}`);
					return undefined;
				}
				stderr = executionError.stderr;
			}
			const matches = parseLazyComments(stderr);
			return { detected: matches.length > 0, matches };
		} finally {
			try {
				unlinkSync(temporaryFile);
			} catch (error) {
				console.error(
					`[oh-my-pi comments] Failed to remove temp file ${temporaryFile}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	} catch (error) {
		console.error(
			`[oh-my-pi comments] AST comment check failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}
