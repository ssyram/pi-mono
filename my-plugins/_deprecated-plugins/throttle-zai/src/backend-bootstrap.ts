/** Private bootstrap identity: exclusive publish via hard link, private permissions. */
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { backendFailure, type BackendResult } from "./backend-failure.js";

export interface BootstrapState {
	version: 1;
	instanceId: string;
	adminUsername: string;
	adminPassword: string;
}

function parseBootstrapState(raw: unknown): BootstrapState | undefined {
	if (raw === null || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	if (record.version !== 1) return undefined;
	const { instanceId, adminUsername, adminPassword } = record;
	if (typeof instanceId !== "string" || instanceId === "") return undefined;
	if (typeof adminUsername !== "string" || adminUsername === "") return undefined;
	if (typeof adminPassword !== "string" || adminPassword === "") return undefined;
	return { version: 1, instanceId, adminUsername, adminPassword };
}

async function rmQuiet(path: string): Promise<void> {
	await rm(path, { force: true }).catch(() => undefined);
}

export async function loadBootstrapState(path: string): Promise<BackendResult<BootstrapState>> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return backendFailure("uninitialized", "bootstrap state missing");
		return backendFailure("storage", "bootstrap state unreadable");
	}
	try {
		const parsed = parseBootstrapState(JSON.parse(text));
		return parsed ? { kind: "ok", value: parsed } : backendFailure("storage", "bootstrap state invalid");
	} catch {
		return backendFailure("storage", "bootstrap state invalid JSON");
	}
}

function randomPassword(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** Exclusive publish: fsync'd temp file + hard link to the final name. EEXIST adopts the
 * winner's complete state; concurrent creators converge on one identity. */
export async function createBootstrapState(path: string): Promise<BackendResult<BootstrapState>> {
	const state: BootstrapState = {
		version: 1,
		instanceId: randomUUID(),
		adminUsername: "qt-owner",
		adminPassword: randomPassword(),
	};
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const tempPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		await writeFile(tempPath, `${JSON.stringify(state)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
		await link(tempPath, path);
		return { kind: "ok", value: state };
	} catch (error) {
		await rmQuiet(tempPath);
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST" || code === "ENOTEMPTY") {
			const existing = await loadBootstrapState(path);
			return existing.kind === "ok" ? existing : backendFailure("storage", "bootstrap publish lost race");
		}
		return backendFailure("storage", "bootstrap publish failed");
	} finally {
		await rmQuiet(tempPath);
	}
}

/** Atomic replace for small private JSON state files (mode 0600). */
export async function writePrivateJson(path: string, value: unknown): Promise<BackendResult<undefined>> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const tempPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		await writeFile(tempPath, `${JSON.stringify(value)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
		await rename(tempPath, path);
		return { kind: "ok", value: undefined };
	} catch {
		await rmQuiet(tempPath);
		return backendFailure("storage", `write ${basename(path)}`);
	}
}

export async function readPrivateJson(path: string): Promise<BackendResult<unknown>> {
	let text: string;
	try {
		text = await readFile(path, "utf-8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return backendFailure("uninitialized", `${basename(path)} missing`);
		return backendFailure("storage", `${basename(path)} unreadable`);
	}
	try {
		return { kind: "ok", value: JSON.parse(text) };
	} catch {
		return backendFailure("storage", `${basename(path)} invalid JSON`);
	}
}
