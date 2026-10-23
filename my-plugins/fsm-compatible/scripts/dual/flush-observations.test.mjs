import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const flush = fileURLToPath(new URL("./flush-observations.mjs", import.meta.url));

test("flush-observations derives provider and model from independent root transcripts", async () => {
	const run = await mkdtemp(join(tmpdir(), "flush-observations-"));
	try {
		for (const directory of ["hc-tool-parts", "hooks"]) await mkdir(join(run, directory));
		const sessions = [];
		for (const role of ["root", "peer"]) {
			const session = { role, protoSid: `ses_${role}`, sessionFile: join(run, `${role}.jsonl`), agentDir: join(run, role, "agent") };
			sessions.push(session);
			const lines = [
				{ type: "message", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "assistant",
					provider: `${role}-provider`, model: `${role}-model`, content: [{ type: "toolCall", id: `plot_${role}_000`, name: "fsm_get_state", arguments: {} }] } },
				{ type: "message", timestamp: "2026-01-01T00:00:00.001Z", message: { role: "toolResult",
					toolCallId: `plot_${role}_000`, toolName: "fsm_get_state", content: [{ type: "text", text: "actual result" }] } },
			];
			await writeFile(session.sessionFile, lines.map((line) => JSON.stringify(line)).join("\n"));
		}
		await writeFile(join(run, "pi-session.json"), JSON.stringify(sessions[0]));
		await writeFile(join(run, "pi-sessions.json"), JSON.stringify(sessions));
		const config = join(run, "flush-cfg.json");
		await writeFile(config, JSON.stringify({ run, work: join(run, "work") }));
		const result = spawnSync(process.execPath, [flush, "--standalone", config], { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		const facade = JSON.parse(await readFile(join(run, "facade-messages.json"), "utf8"));
		for (const role of ["root", "peer"]) {
			const message = facade[`ses_${role}`][0];
			assert.equal(message.info.providerID, `${role}-provider`);
			assert.equal(message.info.modelID, `${role}-model`);
			assert.equal(message.info.agent, null);
			assert.equal(message.parts[0].state.output, "actual result");
			assert.deepEqual(message.parts[0].state.time, { start: 1767225600000, end: 1767225600001 });
		}
	} finally {
		await rm(run, { recursive: true, force: true });
	}
});
