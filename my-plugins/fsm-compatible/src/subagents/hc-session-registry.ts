import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Cross-runtime session registry: maps HC protocol sids to their owning
 * runtime's bridge so agent_send can reach sessions beyond this tree, the way
 * HC delivers to any existing session id in the same instance. Entries live
 * beside the FSM daemon data (shared by every runtime of one experiment). */
export interface CrossTreeEntry {
	readonly sid: string;
	readonly bridgeUrl: string;
	readonly bridgePassword: string;
}

export interface CrossTreeRegistry {
	readonly dir: string;
	publish(entry: CrossTreeEntry): Promise<void>;
	lookup(sid: string): Promise<CrossTreeEntry | undefined>;
	remove(sid: string): Promise<void>;
}

export function crossTreeRegistry(dir: string): CrossTreeRegistry {
	const pathOf = (sid: string) => join(dir, `${sid}.json`);
	return {
		dir,
		async publish(entry) {
			await mkdir(dir, { recursive: true });
			const temporary = join(dir, `${entry.sid}.${process.pid}.tmp`);
			await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
	await rename(temporary, pathOf(entry.sid));
		},
		async lookup(sid) {
			if (!/^ses_[A-Za-z0-9]+$/.test(sid)) return undefined;
			try {
				return JSON.parse(await readFile(pathOf(sid), "utf8")) as CrossTreeEntry;
			} catch {
				return undefined;
			}
		},
		async remove(sid) {
			await rm(pathOf(sid), { force: true });
		},
	};
}

/** Forward a rendered inbox message to the owning runtime's bridge. Returns
 * "delivered" on acceptance, "unknown" when no runtime owns the sid. */
export async function deliverCrossTree(registry: CrossTreeRegistry, target: string, message: string): Promise<"delivered" | "unknown"> {
	const entry = await registry.lookup(target);
	if (!entry) return "unknown";
	const authorization = `Basic ${Buffer.from(`opencode:${entry.bridgePassword}`).toString("base64")}`;
	const reply = await fetch(`${entry.bridgeUrl.replace(/\/$/, "")}/fsm-compatible/agent-message`, {
		method: "POST",
		headers: { authorization, "content-type": "application/json" },
		body: JSON.stringify({ target, message }),
	});
	if (reply.status === 404) return "unknown";
	if (!reply.ok) throw new Error(`cross-tree delivery failed: HTTP ${reply.status}`);
	return "delivered";
}
