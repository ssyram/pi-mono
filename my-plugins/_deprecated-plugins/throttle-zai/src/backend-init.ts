/** E3 `init` subprocess RPC: secrets over stdin, single v1 JSON manifest on stdout. */
import { spawn } from "node:child_process";
import type { PlanScope } from "./plugin-config.js";
import { backendFailure, type BackendResult } from "./backend-failure.js";
import type { BootstrapState } from "./backend-bootstrap.js";

export interface SeedKey {
	name: string;
	apiKey: string;
}

export type InitOutcome = { kind: "created" } | { kind: "existing" };

interface InitReply {
	version: number;
	kind: string;
	instanceId?: string;
	controlUrl?: string;
	relayBaseUrl?: string;
	code?: string;
}

const INIT_TIMEOUT_MS = 20_000;
const MAX_STDOUT = 64 * 1024;

function initInput(state: BootstrapState, controlUrl: string, relayOrigin: string, plan: PlanScope, seed: SeedKey) {
	return {
		version: 1,
		instanceId: state.instanceId,
		controlUrl,
		relayBaseUrl: relayOrigin,
		admin: { username: state.adminUsername, password: state.adminPassword },
		scope: plan,
		seed: { name: seed.name, apiKey: seed.apiKey },
	};
}

export function runBackendInit(
	executable: string,
	configPath: string,
	state: BootstrapState,
	controlUrl: string,
	relayOrigin: string,
	plan: PlanScope,
	seed: SeedKey,
): Promise<BackendResult<InitOutcome>> {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(executable, ["init", configPath, "--json"], { stdio: ["pipe", "pipe", "pipe"] });
		} catch {
			resolve(backendFailure("configuration", "spawn quota-throttle init"));
			return;
		}
		let stdout = "";
		let settled = false;
		const finish = (result: BackendResult<InitOutcome>): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			for (const stream of [child.stdout, child.stderr]) stream.destroy();
			if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
			resolve(result);
		};
		const timer = setTimeout(() => finish(backendFailure("timeout", "quota-throttle init")), INIT_TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf-8");
			if (stdout.length > MAX_STDOUT) finish(backendFailure("unsupported-backend", "init stdout overflow"));
		});
		child.stderr.on("data", () => undefined);
		child.on("error", (error) => {
			const code = (error as NodeJS.ErrnoException).code;
			finish(
				code === "ENOENT"
					? backendFailure("configuration", "quota-throttle executable missing")
					: backendFailure("unsupported-backend", "spawn quota-throttle init"),
			);
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			if (signal !== null) {
				finish(backendFailure("timeout", "quota-throttle init"));
				return;
			}
			if (code === 3) {
				finish(backendFailure("not-ready", "quota-throttle already running"));
				return;
			}
			let reply: InitReply;
			try {
				const parsed = JSON.parse(stdout.trim()) as InitReply;
				if (parsed && typeof parsed === "object" && parsed.version === 1) reply = parsed;
				else {
					finish(backendFailure("unsupported-backend", "init reply not v1 JSON"));
					return;
				}
			} catch {
				finish(backendFailure("unsupported-backend", "init reply not JSON"));
				return;
			}
			if (reply.kind === "error") {
				const codeMap: Record<string, Parameters<typeof backendFailure>[0]> = {
					"identity-conflict": "identity-conflict",
					"invalid-config": "configuration",
					"quota-probe": "quota-probe",
					storage: "storage",
				};
				finish(backendFailure(codeMap[reply.code ?? ""] ?? "unsupported-backend", "quota-throttle init"));
				return;
			}
			if (reply.kind !== "created" && reply.kind !== "existing") {
				finish(backendFailure("unsupported-backend", "init reply kind"));
				return;
			}
			if (reply.instanceId !== state.instanceId || reply.controlUrl !== controlUrl || reply.relayBaseUrl !== relayOrigin) {
				finish(backendFailure("identity-conflict", "init reply identity mismatch"));
				return;
			}
			finish({ kind: "ok", value: { kind: reply.kind } });
		});
		child.stdin.write(`${JSON.stringify(initInput(state, controlUrl, relayOrigin, plan, seed))}\n`);
		child.stdin.end();
	});
}
