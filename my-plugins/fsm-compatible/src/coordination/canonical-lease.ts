import { randomUUID, createHash } from "node:crypto";
import { lstat, mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { HostIdentity } from "../runtime/host-identity.ts";

export interface CanonicalLease {
	readonly path: string;
	release(): Promise<void>;
}

export function coordinationScope(): string {
	if (!process.getuid) throw new RuntimeError("not-ready");
	return join(tmpdir(), `pi-fsm-compatible-${process.getuid()}`, "coord");
}

async function waitForLease(signal: AbortSignal | undefined, deadline: number): Promise<void> {
	if (signal?.aborted) throw new RuntimeError("cancelled");
	const remaining = deadline - Date.now();
	if (remaining <= 0) throw new RuntimeError("deadline-exceeded");
	await new Promise<void>((resolve, reject) => {
		const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
		const abort = () => { clearTimeout(timer); reject(new RuntimeError("cancelled")); };
		const timer = setTimeout(finish, Math.min(20, remaining));
		timer.unref();
		signal?.addEventListener("abort", abort, { once: true });
	});
}

export async function acquireCanonicalLease(
	scope: string,
	host: HostIdentity,
	tool: string,
	rootSessionId: string,
	deadline: number,
	signal?: AbortSignal,
): Promise<CanonicalLease> {
	// Step P2: a physical-host key, never an independent per-root mutex.
	if (!tool || !rootSessionId || !Number.isInteger(host.pid) || host.pid <= 1 || !/^[1-9][0-9]*$/.test(host.startId)) {
		throw new RuntimeError("protocol-invalid");
	}
	await mkdir(scope, { recursive: true, mode: 0o700 });
	const info = await lstat(scope);
	if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077) !== 0) {
		throw new RuntimeError("not-ready");
	}
	const base = dirname(scope);
	const baseInfo = await lstat(base);
	if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink() || (process.getuid && baseInfo.uid !== process.getuid())) {
		throw new RuntimeError("not-ready");
	}
	const digest = createHash("sha256").update(tool).digest("hex");
	const path = join(scope, `${host.pid}-${host.startId}-${digest}`);
	const token = randomUUID();
	for (;;) {
		if (signal?.aborted) throw new RuntimeError("cancelled");
		if (Date.now() >= deadline) throw new RuntimeError("deadline-exceeded");
		try {
			await mkdir(path, { mode: 0o700 });
			break;
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw new RuntimeError("transport-failed");
			await waitForLease(signal, deadline);
		}
	}
	const ownerFile = join(path, "owner.json");
	const ownerText = JSON.stringify({ token, pid: host.pid, startId: host.startId, rootSessionId });
	try {
		await writeFile(ownerFile, ownerText, { flag: "wx", mode: 0o600 });
	} catch {
		await rmdir(path).catch(() => undefined);
		throw new RuntimeError("transport-failed");
	}
	let released = false;
	return Object.freeze({
		path,
		async release() {
			if (released) return;
			if (await readFile(ownerFile, "utf8") !== ownerText) throw new RuntimeError("protocol-invalid");
			await unlink(ownerFile);
			await rmdir(path);
			released = true;
		},
	});
}
