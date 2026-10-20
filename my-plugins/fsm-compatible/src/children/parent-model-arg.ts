import { argv } from "node:process";

/** The parent pi's `--model <id>` value (falls back to undefined for registry default). */
export function parentModelArg(): string | undefined {
	for (let i = 0; i < argv.length - 1; i++) {
		if (argv[i] === "--model" || argv[i] === "-m") {
			const value = argv[i + 1];
			if (typeof value === "string" && value.length > 0 && !value.startsWith("-")) return value;
		}
	}
	return undefined;
}
