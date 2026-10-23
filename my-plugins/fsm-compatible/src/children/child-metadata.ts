import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ChildRunState = "starting" | "busy" | "idle" | "exited" | "stopped" | "suspended" | "error";

export interface ChildMetadata {
	version: 1;
	sessionId: string;
	parentSessionId: string;
	rootSessionId: string;
	tmuxSession: string;
	cwd: string;
	model: string;
	thinking: string;
	launchArgs: string[];
	extraArgs: string[];
	state: ChildRunState;
	hasStarted: boolean;
	outcome: string | null;
	summary: string;
	createdAt: string;
	updatedAt: string;
	error?: string;
}

export function metadataPath(childDir: string): string {
	return join(childDir, "metadata.json");
}

export async function readChildMetadata(childDir: string): Promise<ChildMetadata | null> {
	try {
		const parsed = JSON.parse(await readFile(metadataPath(childDir), "utf8")) as ChildMetadata;
		if (parsed.version !== 1 || typeof parsed.sessionId !== "string" || typeof parsed.state !== "string") return null;
		return parsed;
	} catch { return null; }
}

export async function writeChildMetadata(childDir: string, next: ChildMetadata): Promise<void> {
	const stamped = { ...next, version: 1 as const, updatedAt: new Date().toISOString() };
	const temp = join(childDir, `.metadata.${process.pid}.tmp`);
	await writeFile(temp, `${JSON.stringify(stamped)}\n`, { mode: 0o600 });
	await rename(temp, metadataPath(childDir));
}

/** Patch a subset of fields; concurrent writers last-write-wins per field set. */
export async function patchChildMetadata(childDir: string, patch: Partial<ChildMetadata>): Promise<ChildMetadata | null> {
	const current = await readChildMetadata(childDir);
	if (!current) return null;
	const next = { ...current, ...patch };
	await writeChildMetadata(childDir, next);
	return next;
}

/** Tolerant reader for restore/adoption paths: any readable state beats guessing. */
export async function childStateOr(childDir: string, fallback: ChildRunState): Promise<ChildRunState> {
	return (await readChildMetadata(childDir))?.state ?? fallback;
}
