/**
 * Shared helpers for the model-scout mechanism trials (design-v2 §5).
 * Trial-only code; not product code.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const MECHANISM_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TMP_ROOT = join(MECHANISM_ROOT, ".tmp");
export const REAL_PROVIDER_PROFILES = join(MECHANISM_ROOT, "..", "..", "provider-profiles");
export const INSTALL_RELEASE = "/Users/ssyram/.pi/agent/install/releases/1.6.0/node_modules";
export const SDK_ENTRY = join(INSTALL_RELEASE, "@earendil-works/pi-coding-agent/dist/index.js");
export const FAUX_MODULE = join(INSTALL_RELEASE, "@earendil-works/pi-ai/dist/providers/faux.js");

export const FAUX_PROVIDER_ID = "zai-coding";

/** Failures accumulate; each trial exits non-zero when any check failed. */
export function makeChecker(trialId) {
	const results = [];
	return {
		check(name, condition, detail = "") {
			const pass = condition === true;
			results.push({ name, pass, detail });
			console.log(`[${trialId}] ${pass ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
			return pass;
		},
		summary() {
			const failed = results.filter((r) => !r.pass);
			console.log(`[${trialId}] summary: ${results.length - failed.length}/${results.length} checks passed`);
			if (failed.length > 0) {
				console.log(`[${trialId}] FAILED: ${failed.map((f) => f.name).join(", ")}`);
			}
			return failed.length === 0 ? 0 : 1;
		},
	};
}

export function sha256(path) {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return "<absent>";
	}
}

export function readJson(path, fallback = undefined) {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return fallback;
	}
}

export function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

/**
 * Build an isolated agent dir + project cwd. Extension load order is forced
 * alphabetically: scout loads before/after the faux+profiles group depending
 * on `order`. The real provider-profiles plugin runs via symlink (read-only).
 */
export function buildEnv(name, options = {}) {
	const {
		order = "scout-first",
		withRealProfiles = false,
		officialModels = [{ id: "glm-5.3", name: "GLM-5.3", reasoning: true, contextWindow: 200000, maxTokens: 65536 }],
		cacheModels = [],
		profilesConfig = { "zai-coding-real": { provider: "zai", apiKey: "trial-profile-key" } },
		reuseExisting = false,
	} = options;
	const envRoot = join(TMP_ROOT, name);
	const agentDir = join(envRoot, "agent");
	const cwd = join(envRoot, "cwd");
	const extDir = join(agentDir, "extensions");
	const scoutName = order === "scout-first" ? "aaa-scout-mech" : "zzz-scout-mech";
	const fauxName = order === "scout-first" ? "zzz-profiles-faux" : "aaa-profiles-faux";
	const officialListPath = join(envRoot, "official-list.json");
	const paths = {
		envRoot,
		agentDir,
		cwd,
		extDir,
		scoutName,
		fauxName,
		officialListPath,
		logs: { scout: join(envRoot, "logs", "scout.jsonl"), faux: join(envRoot, "logs", "faux.jsonl") },
		cachePath: join(agentDir, "model-scout-cache", `${FAUX_PROVIDER_ID}.json`),
	};
	if (reuseExisting && existsSync(envRoot)) {
		return paths;
	}
	rmSync(envRoot, { recursive: true, force: true });
	mkdirSync(join(extDir), { recursive: true });
	mkdirSync(cwd, { recursive: true });

	cpSync(join(MECHANISM_ROOT, "bin", "scout-mech"), join(extDir, scoutName), { recursive: true });
	const fauxDst = join(extDir, fauxName);
	cpSync(join(MECHANISM_ROOT, "bin", "profiles-faux"), fauxDst, { recursive: true });
	const fauxEntry = join(fauxDst, "index.ts");
	writeFileSync(fauxEntry, readFileSync(fauxEntry, "utf-8").replaceAll("__FAUX_MODULE__", FAUX_MODULE));

	if (withRealProfiles) {
		cpSync(REAL_PROVIDER_PROFILES, join(extDir, "provider-profiles"), {
			recursive: true,
			dereference: false,
			filter: (src) => !src.includes(`${REAL_PROVIDER_PROFILES}/node_modules`) && !src.includes(`${REAL_PROVIDER_PROFILES}/test`) && !src.includes(`${REAL_PROVIDER_PROFILES}/docs`),
		});
		writeJson(join(agentDir, "provider-profiles.json"), profilesConfig);
	}

	writeJson(join(agentDir, "auth.json"), {
		[FAUX_PROVIDER_ID]: { type: "api_key", key: "trial-stored-key" },
		...(withRealProfiles ? { "zai-coding-real": { type: "api_key", key: "trial-profile-key" } } : {}),
	});

	writeJson(officialListPath, officialModels);

	if (cacheModels.length > 0) {
		writeJson(join(agentDir, "model-scout-cache", `${FAUX_PROVIDER_ID}.json`), {
			version: 1,
			endpoint: "https://faux-zai.example/v1",
			checkedAt: 0,
			models: cacheModels,
		});
	}

	const logs = join(envRoot, "logs");
	mkdirSync(logs, { recursive: true });

	return paths;
}

export function readJsonl(path) {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

/**
 * Local mock HTTP server. Two roles:
 *  - discovery endpoint for the scout wrapper (GET /discover)
 *  - official catalog endpoint for builtin providers (GET /api/models/providers/:id)
 * Query knobs: delayMs, status, body (raw JSON).
 */
export async function startMockServer() {
	const hits = [];
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const delayMs = Number(url.searchParams.get("delayMs") ?? "0");
		const status = Number(url.searchParams.get("status") ?? "200");
		const respond = () => {
			hits.push({ t: Date.now(), path: url.pathname, query: url.search });
			res.writeHead(status, { "content-type": "application/json", "last-modified": new Date(Date.now() + 86400000).toUTCString() });
			res.end(url.searchParams.get("body") ?? JSON.stringify({ models: [] }));
		};
		if (delayMs > 0) setTimeout(respond, delayMs);
		else respond();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	return {
		port,
		url: `http://127.0.0.1:${port}`,
		hits,
		async close() {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

/** Minimal user turn through the real ModelRuntime request path. */
export async function streamOnce(modelRuntime, model) {
	const stream = modelRuntime.streamSimple(model, {
		messages: [{ role: "user", content: [{ type: "text", text: "mechanism trial" }] }],
	}, { maxTokens: 64 });
	return stream.result();
}

export function textOf(message) {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

/** Guard used by every trial: only the isolated temp dir is ever referenced. */
export function assertIsolation(checker, env) {
	const ok = env.agentDir.startsWith(TMP_ROOT) && process.env.PI_CODING_AGENT_DIR === env.agentDir;
	checker.check("isolation: PI_CODING_AGENT_DIR points inside trial .tmp", ok, process.env.PI_CODING_AGENT_DIR ?? "<unset>");
}

export function snapshotDirState(root) {
	const files = new Map();
	const walk = (dir) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) walk(p);
			else files.set(p, sha256(p));
		}
	};
	walk(root);
	return files;
}
