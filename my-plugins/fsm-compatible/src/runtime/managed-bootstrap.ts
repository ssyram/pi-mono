import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { RootHealth, type ManagedFactoryIdentity } from "./root-health.ts";
import { RuntimeError } from "./runtime-error.ts";

export interface ManagedFactory extends ManagedFactoryIdentity {
	readonly factory: ExtensionFactory;
}

export async function installManagedFactories(
	pi: ExtensionAPI,
	factories: readonly ManagedFactory[],
	health: RootHealth,
): Promise<void> {
	// Step P1: install begin before every callback registered by the managed factories.
	pi.on("session_start", (_event, ctx) => { health.begin(ctx.sessionManager.getSessionId()); });
	for (const entry of factories) {
		const proxy = new Proxy(pi, {
			get(target, property, receiver): unknown {
				if (property === "on") {
					return (...args: unknown[]) => {
						const [event, callback] = args;
						if (typeof event !== "string" || typeof callback !== "function") throw new RuntimeError("protocol-invalid");
						if (event !== "session_start") return Reflect.apply(target.on, target, args);
						const registration = health.registerStartup(entry.id);
						const wrapped = async (eventValue: unknown, ctx: ExtensionContext): Promise<unknown> => {
							const epoch = health.epoch;
							if (!epoch) throw new RuntimeError("not-ready");
							const sessionId = ctx.sessionManager.getSessionId();
							try {
								const result: unknown = await Reflect.apply(callback, undefined, [eventValue, ctx]);
								health.observe(epoch, sessionId, registration.token, true);
								health.commit(epoch);
								return result;
							} catch (error) {
								health.observe(epoch, sessionId, registration.token, false);
								throw error;
							}
						};
						const unsubscribe: unknown = Reflect.apply(target.on, target, [event, wrapped]);
						if (typeof unsubscribe !== "function") throw new RuntimeError("protocol-invalid");
						let active = true;
						return () => {
							if (!active) return;
							active = false;
							registration.deactivate();
							Reflect.apply(unsubscribe, undefined, []);
						};
					};
				}
				if (property === "sendUserMessage" || property === "sendMessage") {
					return (...args: unknown[]) => {
						const options = args[1];
						const triggers = property === "sendUserMessage" || (options !== null && typeof options === "object"
							&& "triggerTurn" in options && options.triggerTurn === true);
						if (triggers && !health.ready) throw new RuntimeError("not-ready");
						const method: unknown = Reflect.get(target, property, receiver);
						if (typeof method !== "function") throw new RuntimeError("protocol-invalid");
						return Reflect.apply(method, target, args);
					};
				}
				return Reflect.get(target, property, receiver);
			},
		});
		try {
			await entry.factory(proxy);
			health.markInitialized(entry.id, true);
		} catch {
			health.markInitialized(entry.id, false);
		}
	}
}
