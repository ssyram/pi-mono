import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createObservationApi } from "./observation-api.mjs";

test("observation-api preserves real runtime status/session data and records source PID", async () => {
	const run = await mkdtemp(join(tmpdir(), "observation-api-"));
	const servers = [];
	try {
		const roots = [];
		const events = [];
		for (const role of ["root", "peer"]) {
			const sid = `ses_${role}`;
			const runtime = createServer((req, res) => {
				res.setHeader("content-type", "application/json");
				if (req.url === "/session/status") res.end(JSON.stringify({ [sid]: { type: role === "root" ? "busy" : "idle" } }));
				else if (req.url === `/session/${sid}`) res.end(JSON.stringify({ id: sid, parentID: null, title: role }));
				else { res.statusCode = 404; res.end("{}"); }
			});
			servers.push(runtime);
			await new Promise((resolve) => runtime.listen(0, "127.0.0.1", resolve));
			roots.push({ role, protoSid: sid });
			events.push({ path: `/session/source?session=${sid}`, status: 200, replyBody: {
				session_id: sid, agent_pid: process.pid, opencode_server_url: `http://127.0.0.1:${runtime.address().port}`,
			} });
		}
		await writeFile(join(run, "daemon-calls.jsonl"), events.map((event) => JSON.stringify(event)).join("\n"));
		const original = [{ info: { id: "msg_real" }, parts: [{ type: "tool", callID: "plot_root_000" }] }];
		await writeFile(join(run, "facade-messages.json"), JSON.stringify({ ses_root: original }));
		const facade = createServer(await createObservationApi(run, roots));
		servers.push(facade);
		await new Promise((resolve) => facade.listen(0, "127.0.0.1", resolve));
		const base = `http://127.0.0.1:${facade.address().port}`;
		assert.deepEqual(await (await fetch(`${base}/session/status`)).json(), {
			ses_root: { type: "busy" }, ses_peer: { type: "idle" },
		});
		assert.deepEqual(await (await fetch(`${base}/session/ses_peer`)).json(), { id: "ses_peer", parentID: null, title: "peer" });
		assert.deepEqual(await (await fetch(`${base}/session/ses_root/message`)).json(), original);
		assert.deepEqual(await (await fetch(`${base}/session/ses_missing/message`)).json(), []);
		assert.deepEqual(JSON.parse(await readFile(join(run, "hc.process.json"), "utf8")), { pid: process.pid });
	} finally {
		await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
		await rm(run, { recursive: true, force: true });
	}
});

test("observation-api rejects missing real source identity instead of inventing owner PID", async () => {
	const run = await mkdtemp(join(tmpdir(), "observation-api-"));
	try {
		await writeFile(join(run, "daemon-calls.jsonl"), "");
		await assert.rejects(createObservationApi(run, [{ role: "root", protoSid: "ses_absent" }]), /Missing real process identity/);
	} finally {
		await rm(run, { recursive: true, force: true });
	}
});
