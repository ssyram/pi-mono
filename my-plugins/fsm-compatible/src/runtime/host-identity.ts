import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { readJsonProcess } from "../process/read-json-process.ts";
import { RuntimeError } from "./runtime-error.ts";

export interface HostIdentity {
	readonly pid: number;
	readonly startId: string;
}

export function parseHostIdentity(value: unknown, expectedPid: number): HostIdentity {
	if (!isAdmissionObject(value) || value.pid !== expectedPid || !Number.isInteger(expectedPid) || expectedPid <= 1
		|| typeof value.startId !== "string" || !/^[1-9][0-9]*$/.test(value.startId)) throw new RuntimeError("protocol-invalid");
	if (BigInt(value.startId) > (1n << 64n) - 1n) throw new RuntimeError("protocol-invalid");
	return Object.freeze({ pid: expectedPid, startId: value.startId });
}

export function parseLinuxHostIdentity(stat: string, expectedPid: number): HostIdentity {
	const open = stat.indexOf("(");
	const close = stat.lastIndexOf(")");
	if (open < 0 || close < open || Number(stat.slice(0, open).trim()) !== expectedPid) throw new RuntimeError("protocol-invalid");
	const fields = stat.slice(close + 1).trim().split(/\s+/);
	return parseHostIdentity({ pid: expectedPid, startId: fields[19] }, expectedPid);
}

export async function readHostIdentity(deadline: number, signal?: AbortSignal): Promise<HostIdentity> {
	if (signal?.aborted) throw new RuntimeError("cancelled");
	if (Date.now() >= deadline) throw new RuntimeError("deadline-exceeded");
	if (process.platform === "linux") {
		const stat = await readFile(`/proc/${process.pid}/stat`, { encoding: "utf8", ...(signal ? { signal } : {}) });
		return parseLinuxHostIdentity(stat, process.pid);
	}
	if (process.platform !== "darwin") throw new RuntimeError("not-ready");
	const command = fileURLToPath(new URL("../../.runtime/bin/host-identity", import.meta.url));
	const value = await readJsonProcess({ command, args: [], env: { ...process.env }, deadline, ...(signal ? { signal } : {}) });
	return parseHostIdentity(value, process.pid);
}
