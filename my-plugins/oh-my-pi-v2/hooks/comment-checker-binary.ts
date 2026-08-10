import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface CommentCheckerBinaryResolver {
	reset(): void;
	resolve(): Promise<string | null>;
}

function resolvePackageCandidates(): string[] {
	try {
		const resolved = execSync(
			"node -e \"try{console.log(require.resolve('@code-yeongyu/comment-checker'))}catch{process.exit(1)}\"",
			{ encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] },
		).trim();
		if (resolved) return [join(resolved, "..", "bin", "comment-checker")];
	} catch (error) {
		console.error(
			`[oh-my-pi comments] Failed to resolve comment-checker npm package: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return [];
}

export function createCommentCheckerBinaryResolver(): CommentCheckerBinaryResolver {
	let cachedPath: string | false | undefined;
	return {
		reset() {
			cachedPath = undefined;
		},
		async resolve() {
			if (cachedPath !== undefined) return cachedPath === false ? null : cachedPath;
			try {
				const whichResult = execSync("which comment-checker", {
					encoding: "utf-8",
					timeout: 3000,
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();
				if (whichResult) {
					cachedPath = whichResult;
					return whichResult;
				}
			} catch (error) {
				console.error(
					`[oh-my-pi comments] comment-checker not found in PATH: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			const candidates = [
				join(process.env["HOME"] ?? "", ".npm", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker"),
				...resolvePackageCandidates(),
			];
			for (const candidate of candidates) {
				if (!existsSync(candidate)) continue;
				cachedPath = candidate;
				return candidate;
			}
			cachedPath = false;
			return null;
		},
	};
}
