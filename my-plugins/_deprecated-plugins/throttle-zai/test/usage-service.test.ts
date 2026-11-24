import { describe, expect, it } from "vitest";
import { registerUsageService } from "../src/usage-service.js";
import { PROVIDER_USAGE_QUERY } from "../src/usage-contract.js";
import type { BackendOwner } from "../src/backend-owner.js";
import type { PoolSnapshot } from "../src/pool-snapshot.js";
import { fakeBus } from "./helpers.js";

const readySnapshot: PoolSnapshot = {
	info: { instanceId: "i", controlUrl: "http://127.0.0.1:1", relayBaseUrl: "http://127.0.0.1:9/v1" },
	phase: "ready",
	observedAtMs: Date.now(),
	pollIntervalMs: 60_000,
	healthy: true,
	dryRun: false,
	unmanagedChannelIds: [],
	keys: [
		{ id: "acct-a", channelId: 1, route: "enabled", tier: "active", fiveHour: { usedPercent: 20 }, weekly: { usedPercent: 40 }, query: "ok" },
	],
};

function ownerWith(snapshot: PoolSnapshot | { kind: "error"; code: string }): BackendOwner & { bound: object[] } {
	const bound: object[] = [];
	return {
		relayBaseUrl: "http://127.0.0.1:9/v1",
		bound,
		bindInstance(provider) {
			bound.push(provider);
		},
		owns(provider, selection) {
			return bound.includes(provider as object) && selection.providerId === (provider as { id: string }).id && selection.endpoint === this.relayBaseUrl;
		},
		async ensureRunning() {
			throw new Error("usage must not start the backend");
		},
		async managementSession() {
			throw new Error("unused");
		},
		async readOwnedSnapshot(signal) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			signal.throwIfAborted();
			return snapshot.kind === "error" ? snapshot : { kind: "ok", value: snapshot };
		},
		invalidateReady() {
			undefined;
		},
	};
}

function selection(providerId: string) {
	return { providerId, modelId: "glm-5.3", api: "openai-completions", endpoint: "http://127.0.0.1:9/v1" };
}

function emit(bus: ReturnType<typeof fakeBus>, provider: object, providerId: string, signal = new AbortController().signal): Promise<unknown> | undefined {
	let accepted: Promise<unknown> | undefined;
	bus.emit(PROVIDER_USAGE_QUERY, {
		session: {},
		selection: selection(providerId),
		nativeProvider: provider,
		signal,
		accept(result: Promise<unknown>) {
			accepted = result;
		},
	});
	return accepted;
}

describe("usage service", () => {
	it("claims only owned instances and returns available compact/text", async () => {
		const bus = fakeBus();
		const owner = ownerWith(readySnapshot);
		registerUsageService({ events: bus }, owner, { kind: "equal" });
		const provider = { id: "my-zai" };
		owner.bindInstance(provider);
		expect(emit(bus, {}, "my-zai")).toBeUndefined();
		const result = await emit(bus, provider, "my-zai");
		expect(result).toMatchObject({ kind: "available", compact: "5h ≈20%, week ≈40%" });
	});

	it("maps errors without fallback and passes cancellation through", async () => {
		const bus = fakeBus();
		const failing = ownerWith({ kind: "error", code: "not-ready" });
		registerUsageService({ events: bus }, failing, { kind: "equal" });
		const provider = { id: "my-zai" };
		failing.bindInstance(provider);
		expect(await emit(bus, provider, "my-zai")).toMatchObject({ kind: "error", code: "network" });
		const dryBus = fakeBus();
		const owner = ownerWith({ ...readySnapshot, dryRun: true });
		registerUsageService({ events: dryBus }, owner, { kind: "equal" });
		owner.bindInstance(provider);
		expect(await emit(dryBus, provider, "my-zai")).toMatchObject({ kind: "error", code: "configuration" });
		const cancelBus = fakeBus();
		const controller = new AbortController();
		controller.abort();
		const cancelledOwner = ownerWith(readySnapshot);
		registerUsageService({ events: cancelBus }, cancelledOwner, { kind: "equal" });
		cancelledOwner.bindInstance(provider);
		const result = await emit(cancelBus, provider, "my-zai", controller.signal).catch((error) => error);
		expect(result).toMatchObject({ kind: "cancelled" });
	});
});
