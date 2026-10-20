import type { DaemonRequester } from "../broker/daemon-request.ts";
import { requireDaemonOk } from "../broker/daemon-request.ts";
import { prepareBrokerChannel, type BrokerChannel, type BrokerChannelConfig } from "../broker/broker-channel.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";

export interface RecoverDeps {
	readonly request: DaemonRequester;
	readonly config: BrokerChannelConfig;
	readonly bridgePassword: string | null;
}

/**
 * Root recovery: identity must be confirmable up front; the channel is rebuilt
 * through the same prepare pipeline and the FSM source-auth route is refreshed
 * with the new bridge password. Unknown mutations are never replayed.
 */
export async function recoverRuntime(deps: RecoverDeps, deadline: number, signal?: AbortSignal): Promise<BrokerChannel> {
	if (!deps.config.rootSessionId) throw new Error("root identity not confirmed");
	const channel = await prepareBrokerChannel(deps.config, deadline, signal, deps.request);
	const reply = await deps.request({ method: "POST", path: "/evidence/source-auth", deadline,
		...(signal ? { signal } : {}),
		body: { session_id: deps.config.rootSessionId, password: deps.bridgePassword } });
	requireDaemonOk(reply);
	if (!isAdmissionObject(reply.body)) throw new Error("source-auth protocol-invalid");
	return channel;
}
