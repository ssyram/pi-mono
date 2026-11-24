import { buildEnv, makeChecker, readJsonl, startMockServer, streamOnce, textOf, writeJson, assertIsolation } from "../lib/trial-env.mjs";

import { SDK_ENTRY } from "../lib/trial-env.mjs";

const checker = makeChecker("SMOKE");
const env = buildEnv("smoke", {
	order: "scout-first",
	cacheModels: [{ id: "glm-5.4", name: "GLM-5.4 (scout cache)" }],
});

process.env.PI_CODING_AGENT_DIR = env.agentDir;
process.env.PI_OFFLINE = "1";
process.env.SCOUT_LOG = env.logs.scout;
process.env.FAUX_LOG = env.logs.faux;
process.env.FAUX_OFFICIAL_LIST = env.officialListPath;

const mock = await startMockServer();
process.env.SCOUT_DISCOVERY_URL = `${mock.url}/discover`;

try {
	const sdk = await import(SDK_ENTRY);
	const services = await sdk.createAgentSessionServices({ cwd: env.cwd, agentDir: env.agentDir });
	console.log("[SMOKE] services created; extensions:", services.resourceLoader.getExtensions().extensions.map((e) => e.path.split("/").slice(-1)[0]));
	console.log("[SMOKE] extension load errors:", JSON.stringify(services.resourceLoader.getExtensions().errors));
	console.log("[SMOKE] diagnostics:", JSON.stringify(services.diagnostics));

	const pre = services.modelRuntime.getRegisteredNativeProvider("zai-coding");
	checker.check("pre-bind native is the faux original", pre !== undefined && pre.id === "zai-coding");
	checker.check("pre-bind supplement NOT in catalog", services.modelRuntime.getModel("zai-coding", "glm-5.4") === undefined);

	const { session } = await sdk.createAgentSessionFromServices({ services, noTools: "all" });
	await session.bindExtensions({ mode: "print", onError: (e) => console.log("[SMOKE] ext error:", e.error) });

	const registry = session.extensionRunner;
	const post = services.modelRuntime.getRegisteredNativeProvider("zai-coding");
	checker.check("post-bind native replaced by wrapper", post !== pre);
	checker.check("wrapper preserved auth object", post?.auth === pre?.auth);
	checker.check("wrapper preserved stream fn", post?.stream === pre?.stream);
	const supplement = services.modelRuntime.getModel("zai-coding", "glm-5.4");
	checker.check("supplement visible after bind", supplement !== undefined, supplement?.id ?? "<none>");

	const official = services.modelRuntime.getModel("zai-coding", "glm-5.3");
	checker.check("official visible", official !== undefined);
	if (official) {
		const message = await streamOnce(services.modelRuntime, official);
		console.log("[SMOKE] stream official:", textOf(message));
		checker.check("official streams through preserved transport", textOf(message).includes("glm-5.3"), textOf(message));
	}
	if (supplement) {
		const message = await streamOnce(services.modelRuntime, supplement);
		console.log("[SMOKE] stream supplement:", textOf(message));
		checker.check("supplement streams through preserved transport", textOf(message).includes("glm-5.4"), textOf(message));
	}
	const fauxLog = readJsonl(env.logs.faux);
	console.log("[SMOKE] faux transport log:", JSON.stringify(fauxLog));
	const scoutLog = readJsonl(env.logs.scout);
	console.log("[SMOKE] scout log events:", scoutLog.map((l) => l.event).join(","));
	process.exit(checker.summary());
} catch (error) {
	console.error("[SMOKE] fatal:", error);
	process.exit(2);
} finally {
	await mock.close();
}
