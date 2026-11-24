/** Standard auth.login composition: upstream KEY in, gateway credential out. */
import type { ApiKeyCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { toProviderError, type BackendResult } from "./backend-failure.js";
import { createBootstrapState, loadBootstrapState, type BootstrapState } from "./backend-bootstrap.js";
import { runBackendInit, type SeedKey } from "./backend-init.js";
import { accountTag, addKey, type KeyInput } from "./control-client.js";
import { ensureClientToken } from "./client-token.js";
import type { BackendOwner } from "./backend-owner.js";
import type { PluginConfig, PluginPaths } from "./plugin-config.js";

const LOGIN_DEADLINE_MS = 360_000;

type PreparedBootstrap = { state: BootstrapState; init: "created" | "existing" | null };

async function prepareBootstrap(
	upstreamKey: string,
	config: PluginConfig,
	paths: PluginPaths,
): Promise<BackendResult<PreparedBootstrap>> {
	let bootstrap = await loadBootstrapState(paths.bootstrapFile);
	let created = false;
	if (bootstrap.kind === "error" && bootstrap.code === "uninitialized") {
		bootstrap = await createBootstrapState(paths.bootstrapFile);
		created = bootstrap.kind === "ok";
	}
	if (bootstrap.kind !== "ok") return bootstrap;
	const seed: SeedKey = { name: accountTag({ apiKey: upstreamKey, scope: config.plan }), apiKey: upstreamKey };
	if (created) {
		const init = await runBackendInit(
			config.executable,
			paths.backendConfigFile,
			bootstrap.value,
			config.controlUrl,
			new URL(config.relayBaseUrl).origin,
			config.plan,
			seed,
		);
		if (init.kind !== "ok") return init;
		return { kind: "ok", value: { state: bootstrap.value, init: init.value.kind } };
	}
	return { kind: "ok", value: { state: bootstrap.value, init: null } };
}


export async function loginGatewayClient(
	profileId: string,
	interaction: ProviderAuthInteraction,
	owner: BackendOwner,
	config: PluginConfig,
	paths: PluginPaths,
): Promise<ApiKeyCredential> {
	const deadline = AbortSignal.any([interaction.signal, AbortSignal.timeout(LOGIN_DEADLINE_MS)]);
	const entered = await interaction.prompt({ type: "secret", message: "Zhipu Coding Plan API key" });
	const upstreamKey = entered.trim();
	if (upstreamKey === "") throw new Error("empty Zhipu API key");

	const prepared = await prepareBootstrap(upstreamKey, config, paths);
	if (prepared.kind !== "ok") throw toProviderError(prepared);

	const running = await owner.ensureRunning(deadline);
	if (running.kind !== "ok") throw toProviderError(running);

	if (prepared.value.init === null) {
		const input: KeyInput = { apiKey: upstreamKey, scope: config.plan };
		const imported = await addKey(prepared.value.state, running.value, input, deadline);
		if (imported.kind === "error" && imported.code === "ambiguous-write") {
			const snapshot = await owner.readOwnedSnapshot(deadline);
			const tag = accountTag(input);
			if (!(snapshot.kind === "ok" && snapshot.value.keys.some((key) => key.id === tag))) {
				throw toProviderError(imported);
			}
		} else if (imported.kind !== "ok") {
			throw toProviderError(imported);
		}
	}

	const session = await owner.managementSession(deadline);
	if (session.kind !== "ok") throw toProviderError(session);
	const gatewayKey = await ensureClientToken(
		prepared.value.state.instanceId,
		profileId,
		paths.clientsDir,
		session.value,
		deadline,
	);
	if (gatewayKey.kind !== "ok") throw toProviderError(gatewayKey);
	return { type: "api_key", key: gatewayKey.value };
}
