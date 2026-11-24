/**
 * profiles-faux — MECHANISM TRIAL EXTENSION.
 *
 * Registers a native provider shaped exactly like a provider-profiles
 * instance (provider-profiles/instantiator.ts field set: id/name/baseUrl/
 * headers/auth{apiKey}/getModels/stream/streamSimple, no refreshModels,
 * no filterModels) except that stream/streamSimple delegate to the REAL
 * installed faux provider (fauxProvider from the current release), and the
 * "official catalog" is read live from a fixture file so trials can mutate
 * the official set (takeover proof).
 *
 * Environment channels (trial only):
 *   FAUX_OFFICIAL_LIST  path to JSON array of official model definitions
 *   FAUX_LOG            JSONL transport log path
 *   FAUX_PROFILE_KEY    configured api key for the "profile config" path
 *   FAUX_PROVIDER_ID    provider id (default "zai-coding")
 *
 * __FAUX_MODULE__ is substituted with the installed faux.js path when the
 * trial env is built (see mechanism/lib/trial-env.mjs).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider, Model, ApiKeyAuth, AuthResult } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage } from "__FAUX_MODULE__";
import { readFileSync, writeFileSync, statSync } from "node:fs";

const PROVIDER_ID = process.env.FAUX_PROVIDER_ID ?? "zai-coding";
const FAUX_API = "faux-zai";

interface OfficialDef {
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

function log(event: string, data: Record<string, unknown> = {}): void {
	const path = process.env.FAUX_LOG;
	if (!path) return;
	try {
		writeFileSync(path, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`, { flag: "a" });
	} catch {
		/* never break the transport */
	}
}

let officialCache: { mtimeMs: number; models: Model[] } | undefined;

/** mtime-cached so official objects keep stable references between catalog
 * mutations — like real providers serving stable refs between refreshes. */
function readOfficialList(): Model[] {
	const path = process.env.FAUX_OFFICIAL_LIST;
	if (!path) return [];
	try {
		const stat = statSync(path);
		if (officialCache && officialCache.mtimeMs === stat.mtimeMs) return officialCache.models;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		const models = Array.isArray(parsed) ? (parsed as OfficialDef[]).map(toModel) : [];
		officialCache = { mtimeMs: stat.mtimeMs, models };
		return models;
	} catch {
		return [];
	}
}

const faux = fauxProvider({
	provider: PROVIDER_ID,
	api: FAUX_API,
	models: [{ id: "__placeholder__", name: "placeholder" }],
});

function toModel(def: OfficialDef): Model {
	return {
		id: def.id,
		name: def.name ?? def.id,
		api: FAUX_API,
		provider: PROVIDER_ID,
		baseUrl: "https://faux-zai.example/v1",
		reasoning: def.reasoning === true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: def.contextWindow ?? 128000,
		maxTokens: def.maxTokens ?? 16384,
	} as Model;
}

/** Self-replenishing scripted transport: always answer with the model id. */
function transport(
	fn: "stream" | "streamSimple",
	model: Model,
	options: { apiKey?: string; headers?: Record<string, string> } | undefined,
	run: () => unknown,
): unknown {
	if (faux.getPendingResponseCount() === 0) {
		faux.setResponses([fauxAssistantMessage(`faux:${fn}:${model.id}`)]);
	}
	log("transport", {
		fn,
		model: model.id,
		api: model.api,
		baseUrl: model.baseUrl,
		apiKey: options?.apiKey,
		headers: options?.headers,
	});
	return run();
}

const auth: ApiKeyAuth = {
	name: "API key",
	resolve: async (input): Promise<AuthResult | undefined> => {
		if (input.credential?.key) {
			return { auth: { apiKey: input.credential.key }, source: "stored credential" };
		}
		const configured = process.env.FAUX_PROFILE_KEY;
		if (configured) {
			return { auth: { apiKey: configured }, source: "profile config" };
		}
		return undefined;
	},
};

const native: Provider = {
	id: PROVIDER_ID,
	name: "Zhipu Coding (faux named account)",
	baseUrl: "https://faux-zai.example/v1",
	headers: { "x-faux-profile": PROVIDER_ID },
	auth: { apiKey: auth },
	getModels: () => readOfficialList(),
	stream: (model, context, options) =>
		transport("stream", model, options, () => faux.provider.stream(model, context, options)) as ReturnType<Provider["stream"]>,
	streamSimple: (model, context, options) =>
		transport("streamSimple", model, options, () => faux.provider.streamSimple(model, context, options)) as ReturnType<Provider["streamSimple"]>,
};

export default function profilesFaux(pi: ExtensionAPI): void {
	pi.registerProvider(native);
	log("registered", { provider: PROVIDER_ID, api: FAUX_API });
}
