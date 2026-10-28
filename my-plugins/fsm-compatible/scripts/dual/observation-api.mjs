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
	// The engine's 50ms dependency poll fans out per-request roster/status
	// probes; a short shared TTL keeps the bridges from being hammered.
	const cache = new Map();
	const cached = async (key, ttl, load) => {
		const hit = cache.get(key);
		if (hit && Date.now() - hit.at < ttl) return hit.value;
		const value = await load();
		cache.set(key, { at: Date.now(), value });
		return value;
	};
	const statuses = () => cached("statuses", 250, async () => {
		const merged = {};
		for (const owner of owners) {
			const reply = await fetch(`${owner.url}/session/status`);
			if (!reply.ok) throw new Error(`Runtime status HTTP ${reply.status}`);
			const body = await reply.json();
			// C8: an invalid shape must surface, never wash into an empty map.
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				throw new Error(`Runtime status shape invalid from ${owner.role}`);
			}
			Object.assign(merged, body);
		}
		return merged;
	});
	const tree = () => cached("tree", 250, async () => {
		const rows = [];
		for (const owner of owners) {
			const reply = await fetch(`${owner.url}/session`);
			if (!reply.ok) throw new Error(`Bridge roster HTTP ${reply.status}`);
			rows.push(...await reply.json());
		}
		return rows;
	});
	return async (req, res) => {
		const finish = (status, body) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		try {
			if (req.url === "/__tree") {
				// Merged session tree for request-time roster composition.
				const t0 = Date.now();
				const value = await tree();
				if (process.env.FSM_DUAL_DEBUG) console.error(`__tree ${Date.now() - t0}ms rows=${value.length}`);
				finish(200, value);
				return;
			}
			const messages = /^\/session\/([^/]+)\/message$/.exec(req.url ?? "");
			if (messages) {
				const facade = JSON.parse(await readFile(join(run, "facade-messages.json"), "utf8").catch(() => "{}"));
				finish(200, facade[messages[1]] ?? []);
				return;
			}
			if (req.url === "/session/status") {
				finish(200, await statuses());
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
