import type { ScriptResult, ScriptTask } from "./task-spec.js";

export function buildWakeUpContent(
	task: ScriptTask,
	results: readonly ScriptResult[],
	shouldWake: boolean,
): string {
	const blocks = results.map((result) =>
		[
			`<script="${escapeMarkup(result.script.path)}", exit-code="${result.exitCode ?? "unavailable"}">`,
			...(result.status === "success" ? [] : ["*** FAILED ***"]),
			`status: ${result.status}`,
			`cwd: ${escapeMarkup(result.script.cwd)}`,
			...(result.script.params.length > 0
				? [`params: ${escapeMarkup(JSON.stringify(result.script.params))}`]
				: []),
			...(result.signal === null
				? []
				: [`signal: ${escapeMarkup(result.signal)}`]),
			...(result.error === null
				? []
				: [`error: ${escapeMarkup(result.error)}`]),
			...(result.stdout === "" ? [] : [`stdout:\n${escapeMarkup(result.stdout)}`]),
			...(result.stderr === "" ? [] : [`stderr:\n${escapeMarkup(result.stderr)}`]),
			"</script>",
		].join("\n"),
	);
	const prompts =
		shouldWake && task.wakeUp.kind !== "never"
			? ["<prompts>", escapeMarkup(task.wakeUp.prompt), "</prompts>"]
			: [];
	return [
		"<SYSTEM:loop-wakeup>",
		"This reminder was generated automatically by the system, NOT sent by the user.",
		...prompts,
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
