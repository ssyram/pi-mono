import { argv } from "node:process";

/**
 * Extract the parent pi's `-e <path>` extension flags so child agents load the
 * same provider/plugin set (FSM admission requires children to carry
 * fsm-compatible; mock harnesses need the provider extension).
 */
export function parentExtensionArgs(): string[] {
	const args: string[] = [];
	for (let i = 0; i < argv.length - 1; i++) {
		if (argv[i] === "-e" || argv[i] === "--extension") {
			const value = argv[i + 1];
			if (typeof value === "string" && value.length > 0 && !value.startsWith("-")) {
				args.push("-e", value);
			}
		}
	}
	return args;
}
