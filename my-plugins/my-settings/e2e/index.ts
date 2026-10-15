import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	createMySettingsClient,
	MY_SETTINGS_READY_CHANNEL,
	type Settings,
	type SettingsReady,
	type SettingsResult,
} from "../index.ts";

// ── Schema: each key's default declares its kind; the service filters per-source ──

const DEFAULTS: Settings = {
	"demo.enabled": true,
	"demo.greeting": "Hello from demo consumer",
	"demo.limit": 10,
	"demo.optional": null,
	"demo.tags": ["alpha", "beta"],
	"demo.server": { host: "localhost", port: 8080, tls: false },
	"demo.routes": [
		{ path: "/api/v1", methods: ["GET", "POST"] },
		{ path: "/api/v1/:id", methods: ["GET", "PUT", "DELETE"] },
	],
	"demo.nested": { level1: { level2: { deep: "bottom", arr: [1, 2, 3] } } },
	"demo.matrix": [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	],
};

const DEMO_KEYS = Object.keys(DEFAULTS);

// ── Consumer-side validation (semantic shape, not just JSON legality) ──

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateDemo(values: Settings): string | null {
	const v: Record<string, unknown> = values;
	if (typeof v["demo.enabled"] !== "boolean") return "demo.enabled must be boolean";
	if (typeof v["demo.greeting"] !== "string") return "demo.greeting must be string";
	if (typeof v["demo.limit"] !== "number") return "demo.limit must be number";
	if (v["demo.optional"] !== null) return "demo.optional must be null";
	if (!isStringArray(v["demo.tags"])) return "demo.tags must be string[]";
	const server = v["demo.server"];
	if (!server || typeof server !== "object" || Array.isArray(server)) return "demo.server must be object";
	const s = server as Record<string, unknown>;
	if (typeof s.host !== "string" || typeof s.port !== "number" || typeof s.tls !== "boolean")
		return "demo.server fields wrong";
	const routes = v["demo.routes"];
	if (!Array.isArray(routes)) return "demo.routes must be array";
	for (const r of routes) {
		if (
			!r ||
			typeof r !== "object" ||
			typeof (r as Record<string, unknown>).path !== "string" ||
			!isStringArray((r as Record<string, unknown>).methods)
		)
			return "demo.routes elements wrong";
	}
	const nested = v["demo.nested"];
	if (!nested || typeof nested !== "object") return "demo.nested must be object";
	const n1 = (nested as Record<string, unknown>).level1;
	if (!n1 || typeof n1 !== "object") return "demo.nested.level1 must be object";
	const n2 = (n1 as Record<string, unknown>).level2;
	if (!n2 || typeof n2 !== "object") return "demo.nested.level2 must be object";
	const nd = n2 as Record<string, unknown>;
	if (typeof nd.deep !== "string" || !Array.isArray(nd.arr) || !nd.arr.every((x) => typeof x === "number"))
		return "demo.nested.level2 fields wrong";
	const matrix = v["demo.matrix"];
	if (!Array.isArray(matrix) || !matrix.every((row) => Array.isArray(row) && row.every((x) => typeof x === "number")))
		return "demo.matrix must be number[][]";
	return null;
}

// ── Extension ──

function log(message: string): void {
	try {
		console.log(`[demo-consumer] ${message}`);
	} catch {}
}

function notify(ctx: ExtensionCommandContext, text: string, tone: "info" | "warning"): void {
	try {
		ctx.ui.notify(text, tone);
	} catch {
		log(text);
	}
}

export default function demoSettingsConsumer(pi: ExtensionAPI): void {
	// Pattern 1: subscribe to the ready event in the factory (before session_start)
	pi.events.on(MY_SETTINGS_READY_CHANNEL, (data) => {
		const ready = data as SettingsReady;
		const client = createMySettingsClient(pi.events, ready);
		void client
			.query({ defaults: DEFAULTS })
			.then((result) => {
				if (!result.ok) {
					log(`settings unavailable: ${result.error.code} — ${result.error.message}`);
					return;
				}
				const problem = validateDemo(result.values);
				if (problem) {
					log(`shape mismatch: ${problem}; using built-in defaults`);
					return;
				}
				log(`loaded ${DEMO_KEYS.length} keys (incl. nested objects, arrays, matrix)`);
			})
			.catch(() => log("unexpected query failure"));
	});

	// Pattern 2: interactive command using the real service
	pi.registerCommand("demo-settings", {
		description: "Demo consumer showing sub-JSON values via my-settings",
		handler: async (args, ctx) => {
			const identity = sessionIdentity(ctx);
			if (typeof identity === "string") {
				notify(ctx, identity, "warning");
				return;
			}
			const client = createMySettingsClient(pi.events, identity);
			const trimmed = args.trim();
			const [sub, ...rest] = trimmed.split(/\s+/);

			if (sub === "get" || sub === "" || sub === "help") {
				await report(ctx, await client.query({ defaults: DEFAULTS }));
				return;
			}

			if (sub === "set" && rest.length >= 2) {
				const key = rest[0];
				if (!DEMO_KEYS.includes(key)) {
					notify(ctx, `Unknown key "${key}". Known: ${DEMO_KEYS.join(", ")}`, "warning");
					return;
				}
				let value: unknown;
				try {
					value = JSON.parse(rest.slice(1).join(" "));
				} catch {
					notify(ctx, `VAL not valid JSON: ${rest.slice(1).join(" ")}`, "warning");
					return;
				}
				// Consumer-side type check before sending
				const expected = typeof DEFAULTS[key];
				if (typeof value !== expected) {
					notify(
						ctx,
						`"${key}" expects ${expected}, got ${typeof value} (service kind filter would drop it anyway)`,
						"warning",
					);
					return;
				}
				const saved = await client.saveLocalAndSession({ values: { [key]: value } as Settings });
				if (!saved.ok) {
					notify(ctx, `${saved.error.code}: ${saved.error.message}`, "warning");
					return;
				}
				await report(ctx, await client.query({ defaults: DEFAULTS }));
				return;
			}

			if (sub === "reset" && rest.length >= 1) {
				const key = rest[0];
				if (!DEMO_KEYS.includes(key)) {
					notify(ctx, `Unknown key "${key}"`, "warning");
					return;
				}
				const removed = await client.unsetSession({ keys: [key] });
				if (!removed.ok) {
					notify(ctx, `${removed.error.code}: ${removed.error.message}`, "warning");
					return;
				}
				await report(ctx, await client.query({ defaults: DEFAULTS }));
				return;
			}

			notify(ctx, "Usage: /demo-settings [get | set KEY VAL | reset KEY]", "warning");
		},
	});
}

function sessionIdentity(ctx: ExtensionCommandContext): SettingsReady | string {
	try {
		const manager = (ctx as unknown as { sessionManager?: { getSessionId?: () => unknown } }).sessionManager;
		const sessionId = manager?.getSessionId?.();
		if (manager && typeof sessionId === "string" && sessionId) {
			return { session: manager, sessionId };
		}
		return "no active session";
	} catch {
		return "session identity unavailable";
	}
}

async function report(ctx: ExtensionCommandContext, result: SettingsResult): Promise<void> {
	if (!result.ok) {
		notify(ctx, `${result.error.code}: ${result.error.message}`, "warning");
		return;
	}
	const lines = DEMO_KEYS.map((key) => `  ${key.padEnd(20)} ${JSON.stringify(result.values[key])}`);
	notify(ctx, `[demo-consumer] current settings:\n${lines.join("\n")}`, "info");
}
