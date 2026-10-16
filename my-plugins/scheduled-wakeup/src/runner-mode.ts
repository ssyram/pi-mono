import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function isRunnerEnabled(): boolean {
	return process.env.PI_SCHEDULED_WAKEUP_RUNNER === "1";
}

export function pollerEnabled(ctx: ExtensionContext): boolean {
	const mode = (
		ctx as ExtensionContext & { mode?: "tui" | "rpc" | "json" | "print" }
	).mode;
	if (mode !== undefined)
		return (mode !== "print" && mode !== "json") || isRunnerEnabled();
	const args = process.argv.slice(2);
	const print = args.some(
		(arg, index) =>
			arg === "-p" ||
			arg === "--print" ||
			arg === "--mode=json" ||
			(arg === "--mode" && args[index + 1] === "json"),
	);
	return !print || isRunnerEnabled();
}
