/**
 * T1 — design-v2 §5.1: profiles 与插件两种加载顺序均保留原身份/鉴权/transport。
 *
 * Runs the REAL provider-profiles plugin (copied read-only into the isolated
 * agent dir) plus the faux named-account provider plus scout-mech, in BOTH
 * extension load orders. Proves:
 *  - scout registers nothing at load time (pre-bind natives are originals);
 *  - after session_start the wrapper preserves auth/stream/streamSimple/
 *    baseUrl/name/headers BY REFERENCE for both faux and real profile natives;
 *  - the preserved transport serves supplements with the SAME resolved
 *    apiKey/headers/baseUrl as the unwrapped control request;
 *  - official model objects are reference-identical (params untouched);
 *  - unrelated builtin providers keep an identical catalog;
 *  - models-store.json is never created.
 */
import {
	buildEnv,
	makeChecker,
	readJson,
	readJsonl,
	streamOnce,
	textOf,
	assertIsolation,
	SDK_ENTRY,
} from "../lib/trial-env.mjs";

const checker = makeChecker("T1");
let failures = 0;

for (const order of ["scout-first", "profiles-first"]) {
	const env = buildEnv(`t1-${order}`, {
		order,
		withRealProfiles: true,
		cacheModels: [{ id: "glm-5.4", name: "GLM-5.4 (scout cache)" }],
	});
	process.env.PI_CODING_AGENT_DIR = env.agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.SCOUT_LOG = env.logs.scout;
	process.env.FAUX_LOG = env.logs.faux;
	process.env.FAUX_OFFICIAL_LIST = env.officialListPath;

	const tag = `[T1/${order}]`;
	try {
		const sdk = await import(SDK_ENTRY);
		const services = await sdk.createAgentSessionServices({ cwd: env.cwd, agentDir: env.agentDir });

		const loadedPaths = services.resourceLoader.getExtensions().extensions.map((e) => e.path);
		const scoutIdx = loadedPaths.findIndex((p) => p.includes(env.scoutName));
		const fauxIdx = loadedPaths.findIndex((p) => p.includes(env.fauxName));
		const profilesIdx = loadedPaths.findIndex((p) => p.includes("provider-profiles"));
		const orderOk =
			order === "scout-first" ? scoutIdx < fauxIdx && scoutIdx < profilesIdx : scoutIdx > fauxIdx && scoutIdx > profilesIdx;
		checker.check(`${tag} forced extension load order`, orderOk, `scout=${scoutIdx} faux=${fauxIdx} profiles=${profilesIdx}`);
		checker.check(`${tag} no extension load errors`, services.resourceLoader.getExtensions().errors.length === 0,
			JSON.stringify(services.resourceLoader.getExtensions().errors));

		// Pre-bind originals (scout must not have registered anything at load time).
		const fauxOrig = services.modelRuntime.getRegisteredNativeProvider("zai-coding");
		const realOrig = services.modelRuntime.getRegisteredNativeProvider("zai-coding-real");
		checker.check(`${tag} pre-bind: faux native is original`, fauxOrig !== undefined && fauxOrig.getModels().some((m) => m.id === "glm-5.3"));
		checker.check(`${tag} pre-bind: real provider-profiles native registered`, realOrig !== undefined && realOrig.id === "zai-coding-real",
			realOrig?.name ?? "<none>");
		const realOrigStream = realOrig?.stream;
		const realOrigAuth = realOrig?.auth;
		const realOrigBaseUrl = realOrig?.baseUrl;
		checker.check(`${tag} pre-bind: supplement invisible (no load-time registration)`,
			services.modelRuntime.getModel("zai-coding", "glm-5.4") === undefined);

		// Control request through the UNWRAPPED provider (auth/transport evidence).
		const controlModel = fauxOrig.getModels().find((m) => m.id === "glm-5.3");
		const controlMessage = await streamOnce(services.modelRuntime, controlModel);
		const controlLog = readJsonl(env.logs.faux).filter((l) => l.event === "transport").at(-1);
		checker.check(`${tag} control request used stored credential`, controlLog?.apiKey === "trial-stored-key",
			String(controlLog?.apiKey));
		checker.check(`${tag} control text`, textOf(controlMessage).includes("glm-5.3"), textOf(controlMessage));

		const anthropicPre = services.modelRuntime.getModels("anthropic").map((m) => m.id).sort().join(",");

		const { session } = await sdk.createAgentSessionFromServices({ services, noTools: "all" });
		await session.bindExtensions({ mode: "print", onError: (e) => console.log(`${tag} ext error:`, e.error) });

		const wrapperFaux = services.modelRuntime.getRegisteredNativeProvider("zai-coding");
		const wrapperReal = services.modelRuntime.getRegisteredNativeProvider("zai-coding-real");
		checker.check(`${tag} post-bind: faux native replaced by wrapper`, wrapperFaux !== fauxOrig);
		checker.check(`${tag} post-bind: real native replaced by wrapper`, wrapperReal !== realOrig);
		checker.check(`${tag} faux wrapper preserved auth object`, wrapperFaux.auth === fauxOrig.auth);
		checker.check(`${tag} faux wrapper preserved stream fn`, wrapperFaux.stream === fauxOrig.stream);
		checker.check(`${tag} faux wrapper preserved streamSimple fn`, wrapperFaux.streamSimple === fauxOrig.streamSimple);
		checker.check(`${tag} faux wrapper preserved baseUrl`, wrapperFaux.baseUrl === fauxOrig.baseUrl);
		checker.check(`${tag} faux wrapper preserved name`, wrapperFaux.name === fauxOrig.name);
		checker.check(`${tag} faux wrapper preserved headers`, wrapperFaux.headers === fauxOrig.headers);
		checker.check(`${tag} real wrapper preserved stream fn (ref)`, wrapperReal.stream === realOrigStream);
		checker.check(`${tag} real wrapper preserved auth object (ref)`, wrapperReal.auth === realOrigAuth);
		checker.check(`${tag} real wrapper preserved baseUrl`, wrapperReal.baseUrl === realOrigBaseUrl);

		// Catalog: supplement visible, official objects pass through untouched.
		const supplement = services.modelRuntime.getModel("zai-coding", "glm-5.4");
		checker.check(`${tag} supplement visible after wrap`, supplement !== undefined, supplement?.id ?? "<none>");
		const officialLive = fauxOrig.getModels().find((m) => m.id === "glm-5.3");
		const officialViaWrapper = services.modelRuntime.getModel("zai-coding", "glm-5.3");
		checker.check(`${tag} official model object reference-identical through wrapper`, officialViaWrapper === officialLive);
		const realOfficialViaWrapper = services.modelRuntime.getModel("zai-coding-real", realOrig.getModels()[0].id);
		const realOfficialLive = realOrig.getModels().find((m) => m.id === realOfficialViaWrapper?.id);
		checker.check(`${tag} real profile official model value-identical through wrapper`,
			JSON.stringify(realOfficialViaWrapper) === JSON.stringify(realOfficialLive));

		// Supplement request through the PRESERVED transport: same identity/auth/endpoint.
		const supplementMessage = await streamOnce(services.modelRuntime, supplement);
		const supplementLog = readJsonl(env.logs.faux).filter((l) => l.event === "transport").at(-1);
		checker.check(`${tag} supplement request text`, textOf(supplementMessage).includes("glm-5.4"), textOf(supplementMessage));
		checker.check(`${tag} supplement request used SAME credential as control`, supplementLog?.apiKey === controlLog?.apiKey,
			`${supplementLog?.apiKey} vs ${controlLog?.apiKey}`);
		checker.check(`${tag} supplement request hit SAME baseUrl`, supplementLog?.baseUrl === controlLog?.baseUrl);
		checker.check(`${tag} supplement request carried SAME headers`, JSON.stringify(supplementLog?.headers) === JSON.stringify(controlLog?.headers),
			`${JSON.stringify(supplementLog?.headers)} vs ${JSON.stringify(controlLog?.headers)}`);

		// Unrelated providers untouched.
		const anthropicPost = services.modelRuntime.getModels("anthropic").map((m) => m.id).sort().join(",");
		checker.check(`${tag} unrelated builtin catalog unchanged`, anthropicPre === anthropicPost);

		// Official store: host creates the file as {} on locked reads; no
		// provider entries may exist.
		const storePath = `${env.agentDir}/models-store.json`;
		checker.check(`${tag} models-store.json has no provider entries`, Object.keys(readJson(storePath, {})).length === 0,
			JSON.stringify(Object.keys(readJson(storePath, {}))));
	} catch (error) {
		failures++;
		console.error(`${tag} fatal:`, error);
	}
}

process.exit(checker.summary() + (failures > 0 ? 2 : 0));
