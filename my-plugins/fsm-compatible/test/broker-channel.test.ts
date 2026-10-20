import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareBrokerChannel } from "../src/broker/broker-channel.ts";
import { requireDaemonCapabilities } from "../src/broker/daemon-capabilities.ts";
import type { DaemonRequester } from "../src/broker/daemon-request.ts";
import { root } from "./admission-fixtures.ts";
import { fakeDaemon, protocolDirectory } from "./broker-fixtures.ts";

const capabilityBody = { server_version: "0.11.0", skill_schema_version: 2, wire_contract_version: 2,
	features: ["dispatch_state_admission_v1", "typed_input_exact_v1"] };

async function configFor(t: { after(callback: () => Promise<void> | void): void }) {
	const directory = await protocolDirectory(t);
	return { rootSessionId: "r", cwd: "/work", serverUrl: "http://127.0.0.1:9001", dataDir: directory,
		clientCommand: process.execPath, clientArgs: [fileURLToPath(new URL("./fixtures/fake-mcp.mjs", import.meta.url))],
		env: { ...process.env }, capacity: 2, scope: join(directory, "coord") };
}

test("capability checks use required wire/schema/features, not product version alone", () => {
	assert.equal(requireDaemonCapabilities({ status: 200, body: capabilityBody }).wireContractVersion, 2);
	for (const body of [{ ...capabilityBody, wire_contract_version: 1 }, { ...capabilityBody, skill_schema_version: 1 },
		{ ...capabilityBody, features: [] }, { ...capabilityBody, wire_contract_version: undefined },
		{ ...capabilityBody, features: [...capabilityBody.features, capabilityBody.features[0]] }]) {
		assert.throws(() => requireDaemonCapabilities({ status: 200, body }), { code: "not-ready" });
	}
});

test("channel preparation acquires actual host, source and catalog; closure prevents reuse", async (t) => {
	const config = await configFor(t);
	const daemon = fakeDaemon();
	const request: DaemonRequester = async (input) => input.path === "/capabilities"
		? { status: 200, body: capabilityBody } : daemon.request(input);
	const channel = await prepareBrokerChannel(config, Date.now() + 10000, undefined, request);
	t.after(() => channel.close(Date.now() + 1000));
	assert.equal(channel.signal.aborted, false);
	assert.equal(channel.catalog.size, 2);
	await channel.broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 1000 });
	await channel.close(Date.now() + 1000);
	assert.equal(channel.signal.aborted, true);
	await assert.rejects(channel.broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 1000 }), { code: "not-ready" });
});

test("incompatible daemon or missing source exits before starting Client", async (t) => {
	const config = { ...await configFor(t), clientCommand: "/no-such-client" };
	const seen: string[] = [];
	const request: DaemonRequester = async (input) => {
		seen.push(input.path);
		if (input.path === "/capabilities") return { status: 200, body: capabilityBody };
		return input.method === "POST" ? { status: 200, body: null } : { status: 404, body: {} };
	};
	await assert.rejects(prepareBrokerChannel(config, Date.now() + 10000, undefined, request), { code: "not-ready" });
	assert.deepEqual(seen, ["/capabilities", "/session/register", "/session/source?session=r"]);
});

test("cancelled preparation has no daemon requests or child launch", async (t) => {
	const config = await configFor(t);
	const abort = new AbortController();
	abort.abort();
	const request: DaemonRequester = async () => { assert.fail("cancelled request reached daemon"); };
	await assert.rejects(prepareBrokerChannel(config, Date.now() + 1000, abort.signal, request), { code: "cancelled" });
});
