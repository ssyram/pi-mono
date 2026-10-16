import type { BoulderInhibitSignal, BoulderInhibitionSnapshot } from "./protocol.ts";
import type { BoulderInhibitionClient, BoulderInhibitionFailure } from "./service-protocol.ts";

export type BoulderSetCommand =
	| { kind: "unhandled" }
	| { kind: "invalid"; message: string }
	| { kind: "set"; signal: BoulderInhibitSignal };

export type BoulderSetResult =
	| Exclude<BoulderSetCommand, { kind: "set" }>
	| { kind: "set"; signal: BoulderInhibitSignal; snapshot: BoulderInhibitionSnapshot }
	| { kind: "failed"; signal: BoulderInhibitSignal; failure: BoulderInhibitionFailure };

export function parseBoulderSetCommand(args: string): BoulderSetCommand {
	const tokens = args.trim().split(/\s+/u);
	if (tokens[0].toLowerCase() !== "boulder") return { kind: "unhandled" };
	const value = tokens[3]?.toLowerCase();
	if (tokens.length !== 4 || tokens[1].toLowerCase() !== "set" || !["true", "false", "t", "f"].includes(value)) {
		return { kind: "invalid", message: "Usage: /task boulder set <type> <true|false|t|f>" };
	}
	return { kind: "set", signal: { type: tokens[2], value: value === "true" || value === "t" } };
}

export function executeBoulderSetCommand(
	args: string,
	client: BoulderInhibitionClient,
): BoulderSetResult {
	const command = parseBoulderSetCommand(args);
	if (command.kind !== "set") return command;
	const result = client.set(command.signal);
	return result.ok
		? { kind: "set", signal: command.signal, snapshot: result.snapshot }
		: { kind: "failed", signal: command.signal, failure: result.failure };
}
