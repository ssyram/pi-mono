import { RuntimeResources } from "../runtime/runtime-resources.ts";
import { readHostIdentity } from "../runtime/host-identity.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { requireDaemonCapabilities, type DaemonCapabilities } from "./daemon-capabilities.ts";
import { createDaemonRequester, type DaemonRequester } from "./daemon-request.ts";
import { FsmBroker } from "./fsm-broker.ts";
import { discoverFsmTools, type FsmTool } from "./fsm-catalog.ts";
import { McpTransport } from "./mcp-transport.ts";
import { registerAndConfirmSource } from "./register-source.ts";

export interface BrokerChannelConfig {
	readonly rootSessionId: string;
	readonly cwd: string;
	readonly serverUrl: string;
	readonly dataDir: string;
	readonly clientCommand: string;
	readonly clientArgs: readonly string[];
	readonly env: NodeJS.ProcessEnv;
	readonly capacity: number;
	readonly scope?: string;
}
export interface BrokerChannel {
	readonly broker: FsmBroker;
	readonly catalog: ReadonlyMap<string, FsmTool>;
	readonly capabilities: DaemonCapabilities;
	readonly signal: AbortSignal;
	close(deadline: number): Promise<void>;
}

export async function prepareBrokerChannel(
	config: BrokerChannelConfig,
	deadline: number,
	signal?: AbortSignal,
	request: DaemonRequester = createDaemonRequester(config.dataDir),
): Promise<BrokerChannel> {
	if (!config.rootSessionId || !config.cwd || !config.clientCommand || !config.dataDir
		|| !Number.isInteger(config.capacity) || config.capacity < 1) throw new RuntimeError("protocol-invalid");
	if (signal?.aborted) throw new RuntimeError("cancelled");
	if (Date.now() >= deadline) throw new RuntimeError("deadline-exceeded");
	const resources = new RuntimeResources();
	const cancel = () => { void resources.close(Date.now() + 10000).catch(() => undefined); };
	signal?.addEventListener("abort", cancel, { once: true });
	resources.own(() => { signal?.removeEventListener("abort", cancel); });
	const call = { deadline, signal: resources.signal };
	try {
		const capabilities = requireDaemonCapabilities(await request({ method: "GET", path: "/capabilities", ...call }));
		const host = await readHostIdentity(deadline, resources.signal);
		const source = { rootSessionId: config.rootSessionId, pid: host.pid, cwd: config.cwd, serverUrl: config.serverUrl };
		await registerAndConfirmSource(request, source, deadline, resources.signal);
		if (!resources.open) throw new RuntimeError("cancelled");
		const transport = new McpTransport(config.clientCommand, config.clientArgs, { ...config.env, FSM_DATA_DIR: config.dataDir }, config.capacity);
		resources.own(async (limit) => { if (!(await transport.close(limit))) throw new RuntimeError("delivery-unknown"); });
		await transport.initialize(call);
		const catalog = await discoverFsmTools(transport, call);
		const broker = new FsmBroker({ host, source, request, transport, catalog, capacity: config.capacity,
			...(config.scope ? { scope: config.scope } : {}) });
		resources.own(async (limit) => { if (!(await broker.close(limit))) throw new RuntimeError("delivery-unknown"); });
		if (!resources.open) throw new RuntimeError("cancelled");
		return Object.freeze({ broker, catalog, capabilities, signal: resources.signal,
			close: (limit: number) => resources.close(limit) });
	} catch (error) {
		await resources.close(Date.now() + 10000);
		throw error;
	}
}
