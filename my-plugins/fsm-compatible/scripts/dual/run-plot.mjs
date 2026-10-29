// Pi-side dual runner: drives the unmodified hc-fsm-reference use-plot model script
// against official Pi + fsm-compatible, using the reference package's fixed
// mock/FSM builds. Comparison against HC golden happens offline (next stage);
// this stage proves the plumbing and records where observation adapters are due.
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile, readFile, appendFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startPiRoots } from "./pi-roots.mjs";
import { createObservationApi } from "./observation-api.mjs";

const PLUGIN = fileURLToPath(new URL("../..", import.meta.url));
const REF = resolve(process.env.DUAL_REF ?? join(PLUGIN, "../hc-fsm-reference"));
const FSM = join(REF, ".runtime/fsm-src/target/release");
const MOCK = join(REF, ".runtime/mock-src/target/release/mock-llm-server");
const PI_CLI = process.env.DUAL_PI ?? "/Users/ssyram/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
const plotArg = process.argv.find((a) => a.startsWith("--plot="))?.slice(7);
if (!plotArg) throw new Error("usage: node run-plot.mjs --plot=<plot.json>");
const plotPath = resolve(plotArg);
const plot = JSON.parse(await readFile(plotPath, "utf8"));
const engineRoot = plotPath.includes("/v3/") ? join(REF, "v3") : plotPath.includes("/v4/") ? join(REF, "v4") : plotPath.includes("/v5/") ? join(REF, "v5") : REF;
const stopAnalysis = engineRoot === REF ? "0" : "1";
const facadePort = 21000 + (process.pid % 20000);
const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const run = join("/tmp/fsm-dual", runId);
// v4's frozen engine reads the daemon socket/token at <run>/f directly.
const work = join(run, "work"), agentDir = join(run, "agent"),
	fsmData = join(run, engineRoot.endsWith("/v4") || engineRoot.endsWith("/v5") ? "f" : "fsm"), dataDir = join(run, "plugin-data");
for (const d of ["home", "tmp", "config", "cache", "state", "model-inputs", "hooks", "captures", "hc-tool-parts", "fsm-states", "api-observations", "managed"]) await mkdir(join(run, d), { recursive: true });
for (const d of [work, agentDir, fsmData, dataDir]) await mkdir(d, { recursive: true });

const env = { LANG: process.env.LANG ?? "en_US.UTF-8", LC_ALL: "C", SHELL: "/bin/bash", USER: process.env.USER ?? "ssyram",
	HOME: join(run, "home"), TMPDIR: join(run, "tmp"), XDG_CONFIG_HOME: join(run, "config"), XDG_DATA_HOME: join(run, "data"),
	XDG_CACHE_HOME: join(run, "cache"), XDG_STATE_HOME: join(run, "state"),
	FSM_DATA_DIR: fsmData, FSM_STOP_ANALYSIS: stopAnalysis, FSM_CLIENT_LOG: join(run, "fsm-client.log"),
	PLOT_RUN: run, PLOT_REAL_HOOK: join(FSM, "mcp-server-fsm-hook"),
	PLOT_BINDINGS: JSON.stringify({ run, work, package: engineRoot, ...(plot.bindings ?? {}) }), PLOT_HC_PORT: String(facadePort), PATH: `${FSM}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
	PLOT_TOOL_DEFS_STRICT: process.env.PLOT_TOOL_DEFS_STRICT ?? "1",
	RUST_LOG: process.env.FSM_DUAL_DEBUG ? "debug" : process.env.RUST_LOG ?? "" };

const owned = [];
const start = (name, command, args, cwd = work) => { const child = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
	const log = createWriteStream(join(run, `${name}.log`)); child.stdout.pipe(log); child.stderr.pipe(log); owned.push(child); return child; };
const sha = async (p) => createHash("sha256").update(await readFile(p)).digest("hex");
const http = async (port, path_, body) => { const r = await fetch(`http://127.0.0.1:${port}${path_}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	if (!r.ok) throw new Error(`${path_} -> ${r.status}: ${await r.text()}`); return r.headers.get("content-type")?.includes("json") ? r.json() : r.text(); };
const waitSock = async (deadlineMs) => { const end = Date.now() + deadlineMs;
	while (Date.now() < end) { try { await access(join(fsmData, "server.sock")); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error("FSM daemon socket never appeared"); };
const waitHttp = async (port, path_, deadlineMs) => { const end = Date.now() + deadlineMs; for (;;) { try { await http(port, path_); return; } catch { if (Date.now() > end) throw new Error(`http ${path_} never ready`); await new Promise((r) => setTimeout(r, 100)); } } };

const daemon = start("fsm", join(FSM, "mcp-server-fsm"), ["serve", "--data-dir", fsmData]);
await waitSock(30000);
const runCli = async (...args) => { const r = await import("node:child_process").then((c) => c.execFileSync(join(FSM, "mcp-server-fsm"), args, { env, cwd: work, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }).catch(async (e) => { throw new Error(`cli ${args.join(" ")}: ${e.status} ${String(e.stderr)}`); })); return r; };
for (const yaml of plot.workflows ?? []) { const r = await import("node:child_process").then((c) => c.spawnSync(join(FSM, "mcp-server-fsm"), ["register-skill", join(engineRoot, yaml)], { env, cwd: work, encoding: "buffer" }));
	if (r.status !== 0) throw new Error(`register-skill ${yaml}: ${String(r.stderr)}`);
	await writeFile(join(run, `${yaml.split("/").pop()?.replace(".yaml", "")}.registration.txt`), r.stdout + r.stderr); }

const mockPort = 20000 + (process.pid % 20000);
start("mock", MOCK, ["--port", String(mockPort), "--mounts-file", join(run, "mounts.json"), "--capture-dir", join(run, "captures")]);
await waitHttp(mockPort, "/__admin/scripts", 20000);
const cfgFile = join(run, "flush-cfg.json");
await writeFile(cfgFile, JSON.stringify({ run, work }));
const shim = join(run, "plot-shim.sh");
// D9 declared boundaries (owner ruling a): scheduling-coupled inbox asserts.
const D9_SKIP = plotPath.endsWith("/plots/reference.json") ? { "alpha/009": ["GAMMA_VALUE="], "root/015": ["ALPHA_VALUE="] } : {};
const modelCommand = `PLOT_D9_SKIP='${JSON.stringify(D9_SKIP)}' PLOT_FLUSH_CFG=${cfgFile} PLOT_FLUSH_SCRIPT=${join(PLUGIN, "scripts/dual/flush-observations.mjs")} python3 ${join(PLUGIN, "scripts/dual/profile-boundary.py")} ${engineRoot}`;
await writeFile(shim, `#!/bin/sh\nSTAGE=${join(run, "stage-$$.log")}\nSTDIN_F=${join(run, "stdin-$$.json")}\necho "$$ cat-begin" >> "$STAGE"\ncat > "$STDIN_F"\necho "$$ cat-done" >> "$STAGE"\npython3 -c "import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f, fcntl.LOCK_EX|fcntl.LOCK_NB)" ${join(run, "state.lock")} 2>>${join(run, "shim.log")} && echo "$$ lock-free" >> "$STAGE" || echo "$$ LOCK-HELD" >> "$STAGE"\nEXEC_IN="$STDIN_F" ${modelCommand} ${plotPath} "$@" 2>> ${join(run, "shim.log")}\necho "$$ engine-done rc=$?" >> "$STAGE"\n`, { mode: 0o755 });
const mount = await http(mockPort, "/__admin/scripts", { name: "plot", command: `sh ${shim}` });
await writeFile(join(run, "mount.json"), JSON.stringify(mount, null, 2));

// Wire-encoding adapter (D7): pi-ai encodes user content as text parts while
// the HC reference sent plain strings; the golden comparison is strict on the
// decoded shape. Collapse single-text-part user content on the way to the mock.
const proxyPort = 22000 + (process.pid % 20000);
let toolsSeq = 0;
await mkdir(join(run, "raw-tools"), { recursive: true });
const proxy = (await import("node:http")).createServer(async (req, res) => {
	const chunks = []; for await (const c of req) chunks.push(c);
	const body = Buffer.concat(chunks);
	let out = body;
	try {
		const parsed = JSON.parse(body.toString("utf8"));
		// C4: the mock script input carries no tools array; capture the raw
		// wire definitions so the shim can enforce HC's per-request tool
		// contract.
		if (Array.isArray(parsed?.tools) && parsed.tools.length > 0) {
			// D7 wire normalization: Pi's serializer drops JSON-Schema keys the
			// HC wire carries ($schema, additionalProperties:false). Restore
			// each function's parameters from the authoritative HC snapshot,
			// keeping the observed tool order and names.
			try {
				const hcSchemas = JSON.parse(await readFile(join(PLUGIN, "data", "hc-tool-schemas.json"), "utf8"));
				for (const tool of parsed.tools) {
					const name = tool?.function?.name;
					const hc = hcSchemas[name];
					if (hc) tool.function.parameters = hc.parameters;
				}
			} catch { /* keep raw tools */ }
			const seq = toolsSeq++;
			const mh = createHash("sha256").update(JSON.stringify(parsed.messages?.slice(-6) ?? [])).digest("hex").slice(0, 16);
			writeFile(join(run, "raw-tools", `${String(seq).padStart(4, "0")}.json`), JSON.stringify({ mh, tools: parsed.tools })).catch(() => {});
		}
		if (Array.isArray(parsed?.messages)) {
			for (const message of parsed.messages) {
				if (message.role !== "user" || !Array.isArray(message.content) || message.content.length !== 1
					|| message.content[0]?.type !== "text" || typeof message.content[0]?.text !== "string") continue;
				const text = message.content[0].text;
				// HC carries the agent roster as a separate synthetic text part
				// on the same user message; Pi only has the joined string. Split
				// on the stable sentinel to restore the two-part shape.
				const split = text.indexOf("\n<!-- opencode:subagents -->");
				if (split >= 0 && !text.startsWith("<!-- opencode:subagents -->")) {
					message.content = [
						{ type: "text", text: text.slice(0, split) },
						{ type: "text", text: text.slice(split + 1) },
					];
					continue;
				}
				message.content = text;
			}
			out = Buffer.from(JSON.stringify(parsed));
		}
	} catch { /* non-JSON pass through */ }
	const target = new URL(req.url ?? "/", mount.url);
	const upstream = await fetch(target, { method: req.method, headers: { ...req.headers, host: target.host, "content-length": String(out.length) },
		body: req.method === "GET" || req.method === "HEAD" ? undefined : out });
	res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
	const responseBuffer = Buffer.from(await upstream.arrayBuffer());
	res.end(responseBuffer);
});
await new Promise((r) => proxy.listen(proxyPort, "127.0.0.1", r));
const providerExt = join(run, "plot-provider.ts");
const proxiedUrl = `http://127.0.0.1:${proxyPort}${new URL(mount.url).pathname}`;
await writeFile(providerExt, `import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
export default (pi => { pi.registerProvider("plot", { baseUrl: "${proxiedUrl}/v1", api: "openai-completions", apiKey: "local-no-secret",
	models: [{ id: "plot-model", name: "plot-model", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, contextWindow: 200000, maxTokens: 8192 }] }); }) as ExtensionFactory;\n`);
const configPath = join(run, "plugin-config.json");
await writeFile(configPath, JSON.stringify({ dataDir, clientCommand: join(FSM, "mcp-server-fsm-client"), clientArgs: [], cwd: work,
	capacity: 8, timeoutMs: 15000, modelSource: {}, allowedAgentNames: ["general", "explore"], maxDepth: 3 }));
await writeFile(join(work, "committer.json"), JSON.stringify({ name: "dual", email: "dual@localhost" }));
await import("node:child_process").then((c) => c.spawnSync("/usr/bin/git", ["init", "--quiet", work], { env }));

const piEnv = { ...env, FSM_COMPATIBLE_CLIENT: join(FSM, "mcp-server-fsm-client"), FSM_DUAL_DAEMON_LOG: join(run, "daemon-calls.jsonl"),
	FSM_COMPATIBLE_ROOT_TITLE: String(plot.actors?.root?.title ?? "HC FSM reference") };
const roots = [];
let finalMessage = null, failure = null, facade;
try {
	await startPiRoots({ run, work, agentDir, configPath, env: piEnv, cliPath: PI_CLI, plugin: PLUGIN, providerExt, roles: plot.roots ?? ["root"] }, roots);
	if (engineRoot !== REF) await writeFile(join(run, "state.json"), JSON.stringify({
		bindings: { ...JSON.parse(env.PLOT_BINDINGS), ...Object.fromEntries(roots.map((root) => [`session.${root.role}`, root.protoSid])) }, actors: {}, receipts: {},
	}, null, 2));
	facade = (await import("node:http")).createServer(await createObservationApi(run, roots));
	await new Promise((r) => facade.listen(facadePort, "127.0.0.1", r));

	try {
		await Promise.all(roots.map((root) => root.rpc.promptAndWait(plot.actors[root.role].marker + "\n" + (plot.actors[root.role].initial_prompt ?? plot.prompt), undefined, 240000)));
	} finally {
		for (const root of roots) await writeFile(join(run, `pi-stderr-${root.role}.log`), root.rpc.getStderr()).catch(() => {});
	}
	// HC decouples plot completion from any one prompt's lifecycle: a Stop
	// allow legitimately ends the root prompt while the plot continues through
	// inbox wake-ups. Wait for the plot state itself to close out.
	{
		const deadline = Date.now() + (plot.wait_seconds ?? 90) * 1000 + 30_000;
		while (Date.now() < deadline) {
			const failed = await readFile(join(run, "FAILURE.json"), "utf8").catch(() => null);
			if (failed) break;
			const st = JSON.parse(await readFile(join(run, "state.json"), "utf8").catch(() => "{}"));
			if (st?.actors?.root?.done) break;
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	for (const root of roots) {
		const prefix = root.role === "root" ? "pi" : root.role;
		await writeFile(join(run, `${prefix}-stderr.log`), root.rpc.getStderr());
		await writeFile(join(run, `${prefix}-transcript.jsonl`), root.sessionFile ? await readFile(root.sessionFile, "utf8") : "");
	}
	const manifest = { run: runId, plot: plotPath, engineRoot, stopAnalysis, profileBoundary: engineRoot !== REF, mount, binaries: { mock: await sha(MOCK), server: await sha(join(FSM, "mcp-server-fsm")), client: await sha(join(FSM, "mcp-server-fsm-client")), pi: await sha(PI_CLI) } };
	await writeFile(join(run, "manifest.json"), JSON.stringify(manifest, null, 2));
	try { const history = await import("node:child_process").then((c) => c.execFileSync(join(FSM, "mcp-server-fsm"), ["store", "history"], { env, cwd: work, maxBuffer: 64 * 1024 * 1024 })); await writeFile(join(run, "fsm-history.jsonl"), history); } catch {}
	const plotState = JSON.parse(await readFile(join(run, "state.json"), "utf8").catch(() => "{}"));
	// C5: root alone is not success — every declared actor must close.
	if (!failure) {
		const undone = Object.keys(plot.actors ?? {}).filter((actor) => plotState?.actors?.[actor]?.done !== true);
		if (undone.length > 0) failure = JSON.stringify({ error: `actors not all done: ${undone.join(", ")}` });
	}
	finalMessage = plotState?.actors?.root?.result ?? null;
	failure = await readFile(join(run, "FAILURE.json"), "utf8").catch(() => null);
	await writeFile(join(run, "outcome.json"), JSON.stringify({ finalMessage, failure: failure ? JSON.parse(failure) : null, actorsDone: Object.fromEntries(Object.entries(plotState?.actors ?? {}).map(([k, v]) => [k, v.done])) }, null, 2));
} finally {
	for (const root of roots) { try { await root.rpc.stop(); } catch {} }
	try { facade?.close(); } catch {}
	try { proxy?.close(); } catch {}
	for (const child of owned) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
}
console.log(JSON.stringify({ run, finalMessage, failure: failure ? String(failure).slice(0, 400) : null }, null, 2));
if (failure) process.exit(2);
if (!finalMessage) process.exit(1);
