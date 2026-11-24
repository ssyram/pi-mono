/**
 * T2 — design-v2 §5.2: 缓存补充在启动选模型/普通 refresh 时可见;缓存阶段无外部等待。
 *
 * Phase 1 (process A): wrap, select the cached supplement as the session
 * model (persisted as model_change), exit.
 * Phase 2 (process B, spawned): fresh runtime against the same agent dir —
 *   - pre-bind: supplement invisible (honest limitation of post-bind
 *     wrapping; recorded, then mitigated);
 *   - after bindExtensions: supplement visible with ZERO network calls;
 *   - the session's saved selection is re-applied via pi.setModel, closing
 *     the resume gap before any user request;
 *   - restore wall-time is bounded (local file read only).
 * The mock discovery server runs the whole time and must record 0 hits.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildEnv,
	makeChecker,
	readJson,
	readJsonl,
	startMockServer,
	assertIsolation,
	SDK_ENTRY,
} from "../lib/trial-env.mjs";

const checker = makeChecker("T2");
const phase = process.argv.includes("--phase2");

const env = buildEnv("t2", {
	order: "scout-first",
	cacheModels: [{ id: "glm-5.4", name: "GLM-5.4 (scout cache)" }],
	reuseExisting: phase,
});
process.env.PI_CODING_AGENT_DIR = env.agentDir;
process.env.PI_OFFLINE = "1";
process.env.SCOUT_LOG = env.logs.scout;
process.env.FAUX_LOG = env.logs.faux;
process.env.FAUX_OFFICIAL_LIST = env.officialListPath;

if (phase) {
	// ---- phase 2: fresh process, same agent dir ----
	const mock = await startMockServer();
	process.env.SCOUT_DISCOVERY_URL = `${mock.url}/discover`;
	try {
		const sdk = await import(SDK_ENTRY);
		assertIsolation(checker, env);
		const services = await sdk.createAgentSessionServices({ cwd: env.cwd, agentDir: env.agentDir });
		checker.check("phase2 pre-bind: supplement invisible (post-bind wrap limitation, recorded)",
			services.modelRuntime.getModel("zai-coding", "glm-5.4") === undefined);

		const sessionsDir = join(env.agentDir, "sessions", `--${env.cwd.replace(/^\/+/, "").replace(/[/\\:]/g, "-")}--`);
		const sessionFiles = existsSync(sessionsDir)
			? readdirSync(sessionsDir).filter((f) => f.endsWith(".json")).sort().map((f) => join(sessionsDir, f))
			: [];
		checker.check("phase2: phase-1 session file exists", sessionFiles.length >= 1, sessionFiles.join(","));
		const sessionManager = sdk.SessionManager.open(sessionFiles.at(-1), sessionsDir, env.cwd);

		const created = await sdk.createAgentSessionFromServices({ services, sessionManager, noTools: "all" });
		checker.check("phase2: initial model restore fell back (pre-bind gap is real)",
			created.session.model?.id !== "glm-5.4", `${created.session.model?.provider}/${created.session.model?.id} :: fallback="${created.modelFallbackMessage ?? ""}"`);

		const bindStart = Date.now();
		await created.session.bindExtensions({ mode: "print", onError: (e) => console.log("[T2] ext error:", e.error) });
		const bindMs = Date.now() - bindStart;

		checker.check("phase2: supplement visible immediately after bind (eager cache restore)",
			services.modelRuntime.getModel("zai-coding", "glm-5.4") !== undefined);
		checker.check("phase2: bind+restore completed quickly (no external wait)", bindMs < 5000, `${bindMs}ms`);
		checker.check("phase2: supplement is selectable/available (auth configured)",
			(await services.modelRuntime.getAvailable("zai-coding")).some((m) => m.id === "glm-5.4"));

		// Saved selection re-applied by the mechanism (resume-gap mitigation).
		let restored = false;
		for (let i = 0; i < 100 && !restored; i++) {
			restored = created.session.model?.provider === "zai-coding" && created.session.model?.id === "glm-5.4";
			if (!restored) await new Promise((r) => setTimeout(r, 50));
		}
		checker.check("phase2: saved selection (zai-coding/glm-5.4) re-applied before any request", restored,
			`${created.session.model?.provider}/${created.session.model?.id}`);

		const scoutLog = readJsonl(env.logs.scout);
		const events = scoutLog.map((l) => l.event);
		checker.check("phase2: cache restored via file only (restore events present)",
			events.includes("cache_restore") && scoutLog.some((l) => l.event === "cache_restore" && l.restored === true));
		checker.check("phase2: registration-triggered restore refresh ran (allowNetwork:false)",
			scoutLog.some((l) => l.event === "refresh_begin" && l.allowNetwork === false));
		checker.check("phase2: ZERO discovery fetches while offline", !events.includes("discovery_fetch_begin"),
			events.join(","));
		checker.check("phase2: ZERO requests to mock server during entire offline phase", mock.hits.length === 0,
			JSON.stringify(mock.hits.map((h) => h.path)));
		checker.check("phase2: models-store.json has no provider entries",
			Object.keys(readJson(join(env.agentDir, "models-store.json"), {})).length === 0);
		process.exit(checker.summary());
	} catch (error) {
		console.error("[T2] phase2 fatal:", error);
		process.exit(2);
	} finally {
		await mock.close();
	}
}

// ---- phase 1: wrap + select supplement + persist session ----
const mock = await startMockServer();
process.env.SCOUT_DISCOVERY_URL = `${mock.url}/discover`;
try {
	const sdk = await import(SDK_ENTRY);
	assertIsolation(checker, env);
	const services = await sdk.createAgentSessionServices({ cwd: env.cwd, agentDir: env.agentDir });
	const { session } = await sdk.createAgentSessionFromServices({ services, noTools: "all" });
	await session.bindExtensions({ mode: "print", onError: () => {} });
	const supplement = services.modelRuntime.getModel("zai-coding", "glm-5.4");
	checker.check("phase1: supplement visible after bind", supplement !== undefined);
	await session.setModel(supplement);
	checker.check("phase1: session model set to supplement",
		session.model?.provider === "zai-coding" && session.model?.id === "glm-5.4",
		`${session.model?.provider}/${session.model?.id}`);
	checker.check("phase1: no requests to mock server", mock.hits.length === 0);

	// Let the session manager's async append queue flush the file to disk.
	const sessionsDirP1 = join(env.agentDir, "sessions", `--${env.cwd.replace(/^\/+/, "").replace(/[/\\:]/g, "-")}--`);
	let sessionFlushed = false;
	for (let i = 0; i < 100 && !sessionFlushed; i++) {
		await new Promise((r) => setTimeout(r, 50));
		sessionFlushed = existsSync(sessionsDirP1) && readdirSync(sessionsDirP1).some((f) => f.endsWith(".json"));
	}
	checker.check("phase1: session file flushed to disk", sessionFlushed);

	// phase 2 in a FRESH process against the same agent dir.
	const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--phase2"], {
		env: { ...process.env, SCOUT_LOG: env.logs.scout, FAUX_LOG: env.logs.faux },
		encoding: "utf-8",
		cwd: process.cwd(),
	});
	console.log(result.stdout ?? "");
	console.error(result.stderr ?? "");
	process.exit(result.status ?? 2);
} catch (error) {
	console.error("[T2] phase1 fatal:", error);
	process.exit(2);
} finally {
	await mock.close();
}
