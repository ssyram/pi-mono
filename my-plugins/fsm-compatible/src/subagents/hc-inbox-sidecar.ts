import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HcSessionRecord } from "./hc-session-record.ts";

/** Steered input only enters the transcript when the next request is built;
 * observers waiting on the delivery need it on disk immediately. */
export function recordInboxSidecar(record: HcSessionRecord, text: string): void {
	if (!record.sessionFile) return;
	void appendFile(join(dirname(record.sessionFile), "inbox.jsonl"), JSON.stringify({ text, ts: Date.now() }) + "\n").catch(() => {});
}
