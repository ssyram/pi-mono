import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createObservationApi(run, roots) {
	const lines = (await readFile(join(run, "daemon-calls.jsonl"), "utf8")).split("\n").filter(Boolean);
	const sources = new Map();
	for (const line of lines) {
		const event = JSON.parse(line);
		if (event.path.startsWith("/session/source?") && event.status === 200) {
			sources.set(event.replyBody.session_id, event.replyBody);
		}
	}
	const owners = roots.map((root) => {
		const source = sources.get(root.protoSid);
		if (!source || !Number.isInteger(source.agent_pid) || source.agent_pid <= 0) {
			throw new Error(`Missing real process identity for ${root.role}`);
		}
		return { role: root.role, pid: source.agent_pid, url: source.opencode_server_url };
	});
	await writeFile(join(run, "hc.process.json"), JSON.stringify({ pid: owners.find((owner) => owner.role === "root").pid }));
	await writeFile(join(run, "pi-processes.json"), JSON.stringify(owners, null, 2));
	return async (req, res) => {
		const finish = (status, body) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		try {
			const messages = /^\/session\/([^/]+)\/message$/.exec(req.url ?? "");
			if (messages) {
				const facade = JSON.parse(await readFile(join(run, "facade-messages.json"), "utf8").catch(() => "{}"));
				finish(200, facade[messages[1]] ?? []);
				return;
			}
			if (req.url === "/session/status") {
				const statuses = {};
				for (const owner of owners) {
					const reply = await fetch(`${owner.url}/session/status`);
					if (!reply.ok) throw new Error(`Runtime status HTTP ${reply.status}`);
					Object.assign(statuses, await reply.json());
				}
				finish(200, statuses);
				return;
			}
			if (/^\/session\/[^/]+$/.test(req.url ?? "")) {
				for (const owner of owners) {
					const reply = await fetch(`${owner.url}${req.url}`);
					if (reply.status === 404) continue;
					finish(reply.status, await reply.json());
					return;
				}
			}
			finish(404, {});
		} catch (error) {
			finish(502, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}
