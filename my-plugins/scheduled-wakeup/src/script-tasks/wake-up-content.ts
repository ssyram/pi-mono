import type { ScriptResult, ScriptTask } from "./task-spec.js";

export function buildWakeUpContent(
	task: ScriptTask,
	results: readonly ScriptResult[],
): string {
	const prompt = task.wakeUp.kind === "never" ? "" : task.wakeUp.prompt;
	const blocks = results.map((result) =>
		[
			`<script="${escapeMarkup(result.script.path)}", exit-code="${result.exitCode ?? "unavailable"}">`,
			...(result.status === "success" ? [] : ["*** FAILED ***"]),
			`status: ${result.status}`,
			`cwd: ${escapeMarkup(result.script.cwd)}`,
			`params: ${escapeMarkup(JSON.stringify(result.script.params))}`,
			`signal: ${escapeMarkup(result.signal ?? "none")}`,
			`error: ${escapeMarkup(result.error ?? "none")}`,
			`stdout:\n${escapeMarkup(result.stdout)}`,
			`stderr:\n${escapeMarkup(result.stderr)}`,
			"</script>",
		].join("\n"),
	);
	return [
		"<SYSTEM:loop-wakeup>",
		"This reminder was generated automatically by the system, NOT sent by the user.",
		"<prompts>",
		escapeMarkup(prompt),
		"</prompts>",
		...blocks,
		"</SYSTEM:loop-wakeup>",
	].join("\n");
}

function escapeMarkup(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
