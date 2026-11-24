/**
 * T-PRE — minimal decisive trial (one run, explicit timeout):
 * does a LOAD-TIME extension config overlay survive the services flush for
 * (a) an id claimed by a native provider registration (profile id), and
 * (b) a builtin id no native claims?
 * Source prediction (agent-session-services.js:72-97 + model-runtime.js:642-676):
 * configs flush FIRST, then natives delete same-id overlays -> (a) dead, (b) alive.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnv, makeChecker, SDK_ENTRY } from "../lib/trial-env.mjs";

const checker = makeChecker("T-PRE");
const env = buildEnv("t-pre", { order: "scout-first" });
const overlayDir = join(env.extDir, "000-overlay");
mkdirSync(overlayDir, { recursive: true });
writeFileSync(
	join(overlayDir, "index.ts"),
	`export default function overlay(pi: any): void {
	pi.registerProvider("zai-coding", {
		name: "prebind-overlay-profile",
		baseUrl: "https://faux-zai.example/v1",
		api: "faux-zai",
		models: [{
			id: "glm-overlay-prebind", name: "overlay", input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: false, contextWindow: 128000, maxTokens: 16384,
		}],
	});
	pi.registerProvider("anthropic", { name: "prebind-overlay-builtin" });
}
`,
);

process.env.PI_CODING_AGENT_DIR = env.agentDir;
process.env.PI_OFFLINE = "1";
process.env.SCOUT_LOG = env.logs.scout;
process.env.FAUX_LOG = env.logs.faux;
process.env.FAUX_OFFICIAL_LIST = env.officialListPath;

const sdk = await import(SDK_ENTRY);
const services = await sdk.createAgentSessionServices({ cwd: env.cwd, agentDir: env.agentDir });

// (a) profile id: overlay must be dead; native intact
checker.check("(a) overlay on native-claimed id deleted by native flush",
	services.modelRuntime.getRegisteredProviderConfig("zai-coding") === undefined,
	JSON.stringify(services.modelRuntime.getRegisteredProviderConfig("zai-coding") ?? null));
checker.check("(a) native (faux profile) still the registered provider",
	services.modelRuntime.getRegisteredNativeProvider("zai-coding") !== undefined);
checker.check("(a) overlay model NOT in catalog pre-resolution",
	services.modelRuntime.getModel("zai-coding", "glm-overlay-prebind") === undefined);
checker.check("(a) official model still in catalog",
	services.modelRuntime.getModel("zai-coding", "glm-5.3") !== undefined);

// (b) builtin id: overlay survives (but would replace models if it listed any)
const anthropicOverlay = services.modelRuntime.getRegisteredProviderConfig("anthropic");
checker.check("(b) overlay on builtin id SURVIVES flush (pre-resolution wiring exists only for builtin ids)",
	anthropicOverlay !== undefined, JSON.stringify(anthropicOverlay ?? null));
checker.check("(b) anthropic catalog untouched by models-less overlay",
	services.modelRuntime.getModel("anthropic", "claude-opus-5-5") !== undefined);

process.exit(checker.summary());
