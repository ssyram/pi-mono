/** Per-load shared backend lifecycle: startup merge, identity handshake, owned instances. */
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import { backendFailure, type BackendResult } from "./backend-failure.js";
import { loadBootstrapState } from "./backend-bootstrap.js";
import { getSnapshot } from "./control-client.js";
import { createNewApiSession, type NewApiSession } from "./newapi-session.js";
import { ensureOwnedRelayPolicy } from "./relay-policy.js";
import type { PluginConfig, PluginPaths } from "./plugin-config.js";
import type { BackendInfo, PoolSnapshot } from "./pool-snapshot.js";
import type { UsageSelectionIdentity } from "./usage-contract.js";

const STARTUP_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;
const HTTP_TIMEOUT_MS = 3_000;
const ENSURE_TIMEOUT_MS = 75_000;

export interface BackendOwner {
	readonly relayBaseUrl: string;
	bindInstance(provider: Provider): void;
	owns(provider: unknown, selection: UsageSelectionIdentity): boolean;
	ensureRunning(signal: AbortSignal): Promise<BackendResult<BackendInfo>>;
	managementSession(signal: AbortSignal): Promise<BackendResult<NewApiSession>>;
	readOwnedSnapshot(signal: AbortSignal): Promise<BackendResult<PoolSnapshot>>;
	invalidateReady(): void;
}

type DaemonState =
	| { kind: "idle" }
	| { kind: "starting"; task: Promise<BackendResult<BackendInfo>> }
	| { kind: "ready"; info: BackendInfo; checkedAtMs: number; session?: NewApiSession };

async function isControlAlive(info: BackendInfo, signal: AbortSignal): Promise<boolean> {
	try {
		const response = await fetch(`${info.controlUrl}/api/status.service`, {
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function isRelayHealthy(info: BackendInfo, signal: AbortSignal): Promise<boolean> {
	const origin = new URL(info.relayBaseUrl).origin;
	try {
		const response = await fetch(`${origin}/api/status`, {
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export function createBackendOwner(
	config: PluginConfig,
	paths: PluginPaths,
	metadataIds: readonly string[],
): BackendOwner {
	const instances = new WeakSet<object>();
	let state: DaemonState = { kind: "idle" };

	function expectedInfo(instanceId: string): BackendInfo {
		return { instanceId, controlUrl: config.controlUrl, relayBaseUrl: config.relayBaseUrl };
	}

	async function spawnUp(): Promise<void> {
		const logFile = await open(join(paths.backendDir, "quota-throttle.log"), "a").catch(() => undefined);
		const child = spawn(config.executable, ["up", paths.backendConfigFile], {
			detached: true,
			stdio: ["ignore", logFile ? logFile.fd : "ignore", logFile ? logFile.fd : "ignore"],
		});
		child.on("error", () => logFile?.close().catch(() => undefined));
		child.on("close", () => logFile?.close().catch(() => undefined));
		child.unref();
	}

	async function requestBackendEnsure(info: BackendInfo, signal: AbortSignal): Promise<void> {
		try {
			await fetch(`${info.controlUrl}/api/backend/ensure`, {
				method: "POST",
				headers: { "x-qt-panel": "1" },
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(ENSURE_TIMEOUT_MS)]),
			});
		} catch {
			// Result unknown either way; the poll loop converges on /api/status.
		}
	}

	async function runBackend(callerSignal: AbortSignal): Promise<BackendResult<BackendInfo>> {
		if (callerSignal.aborted) return { kind: "cancelled" };
		if (state.kind === "ready") {
			if (Date.now() - state.checkedAtMs < 5_000) return { kind: "ok", value: state.info };
			if (await isControlAlive(state.info, callerSignal)) {
				state = { ...state, checkedAtMs: Date.now() };
				return { kind: "ok", value: state.info };
			}
			state = { kind: "idle" };
		}
		if (state.kind === "starting") return state.task;
		const task = startBackend(callerSignal).then((result) => {
			if (result.kind !== "ok" && state.kind === "starting") state = { kind: "idle" };
			return result;
		});
		state = { kind: "starting", task };
		return task;
	}

	async function readSnapshot(info: BackendInfo, signal: AbortSignal): Promise<BackendResult<PoolSnapshot>> {
		const outcome = await getSnapshot(info, signal);
		if (outcome.kind === "ok") return { kind: "ok", value: outcome.snapshot };
		if (outcome.kind === "starting") return backendFailure("not-ready", "backend starting");
		if (outcome.kind === "cancelled") return outcome;
		return outcome;
	}

	async function startBackend(callerSignal: AbortSignal): Promise<BackendResult<BackendInfo>> {
		const bootstrap = await loadBootstrapState(paths.bootstrapFile);
		if (bootstrap.kind !== "ok") return bootstrap;
		const info = expectedInfo(bootstrap.value.instanceId);
		const deadline = AbortSignal.timeout(STARTUP_TIMEOUT_MS);
		const signal = AbortSignal.any([callerSignal, deadline]);
		let upSpawned = false;
		let ensureSent = false;
		let lastIdentity: BackendResult<BackendInfo> | undefined;
		while (!signal.aborted) {
			const outcome = await getSnapshot(info, signal);
			if (process.env.TZAI_DEBUG) console.error("DBG poll", outcome.kind, outcome.kind === "ok" ? `${outcome.snapshot.healthy}/${outcome.snapshot.dryRun}` : JSON.stringify(outcome).slice(0, 90));

			if (outcome.kind === "cancelled") return outcome;
			if (outcome.kind !== "starting" && outcome.kind !== "ok" && outcome.kind !== "cancelled") {
				lastIdentity = outcome;
				if (!upSpawned) {
					await spawnUp();
					upSpawned = true;
				}
			} else if (outcome.kind === "ok" && outcome.snapshot.healthy && !outcome.snapshot.dryRun) {

				if (await isRelayHealthy(info, signal)) {
					const session = createNewApiSession(
						new URL(info.relayBaseUrl).origin,
						bootstrap.value.adminUsername,
						bootstrap.value.adminPassword,
					);
					const authenticated = await session.authenticate(signal);
					if (process.env.TZAI_DEBUG) console.error("DBG auth", JSON.stringify(authenticated).slice(0, 90));

					if (authenticated.kind !== "ok") {
						lastIdentity = authenticated;
					} else {
						const policy = await ensureOwnedRelayPolicy(session, outcome.snapshot, metadataIds, signal);
						if (process.env.TZAI_DEBUG) console.error("DBG policy", JSON.stringify(policy).slice(0, 90));

						if (policy.kind === "error" || policy.kind === "cancelled") {
							lastIdentity = policy;
						} else {
							state = { kind: "ready", info, checkedAtMs: Date.now(), session };
							return { kind: "ok", value: info };
						}
					}
				}
			} else if (outcome.kind === "starting" && !upSpawned) {
				await spawnUp();
				upSpawned = true;
			}
			if (outcome.kind === "ok" && !outcome.snapshot.healthy && (await isControlAlive(info, signal))) {
				if (!ensureSent) {
					await requestBackendEnsure(info, signal);
					ensureSent = true;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		}
		if (callerSignal.aborted) return { kind: "cancelled" };
		return lastIdentity?.kind === "error" ? lastIdentity : backendFailure("startup-timeout", "backend ready");
	}

	return {
		get relayBaseUrl() {
			return config.relayBaseUrl;
		},
		bindInstance(provider) {
			instances.add(provider);
		},
		owns(provider, selection) {
			return (
				provider !== null &&
				typeof provider === "object" &&
				instances.has(provider) &&
				selection.providerId === (provider as Provider).id &&
				selection.api === "openai-completions" &&
				selection.endpoint === config.relayBaseUrl
			);
		},
		ensureRunning: runBackend,
		async managementSession(signal) {
			const running = await runBackend(signal);
			if (running.kind !== "ok") return running;
			if (state.kind === "ready" && state.session) return { kind: "ok", value: state.session };
			return backendFailure("not-ready", "management session");
		},
		async readOwnedSnapshot(signal) {
			const bootstrap = await loadBootstrapState(paths.bootstrapFile);
			if (bootstrap.kind !== "ok") return bootstrap;
			return readSnapshot(expectedInfo(bootstrap.value.instanceId), signal);
		},
		invalidateReady() {
			if (state.kind === "ready") state = { kind: "idle" };
		},
	};
}
