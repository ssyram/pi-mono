import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getApiProviders } from "@mariozechner/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
	let sessionId = "";
	let cwd = "";
	let seq = 0;
	let hooked = false;

	pi.on("session_start", (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		cwd = ctx.cwd;
		installProviderHooks();
	});

	function getTranscriptDir(): string {
		return join(cwd, ".pi", "transcripts", sessionId);
	}

	function writeTranscript(data: Record<string, unknown>): void {
		try {
			const dir = getTranscriptDir();
			mkdirSync(dir, { recursive: true });
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const filePath = join(dir, `${timestamp}_${String(seq++).padStart(4, "0")}.json`);
			writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
		} catch {
			// Never break LLM calls due to transcript failures
		}
	}

	function installProviderHooks(): void {
		if (hooked) return;
		hooked = true;
		const providers = getApiProviders();
		for (const provider of providers) {
			const origStream = provider.stream;
			const origStreamSimple = provider.streamSimple;

			provider.stream = (model, context, options) => {
				writeTranscript({
					type: "stream",
					timestamp: new Date().toISOString(),
					model: { id: model.id, api: model.api, provider: model.provider },
					context,
					options: sanitizeOptions(options),
				});
				return origStream(model, context, options);
			};

			provider.streamSimple = (model, context, options) => {
				writeTranscript({
					type: "streamSimple",
					timestamp: new Date().toISOString(),
					model: { id: model.id, api: model.api, provider: model.provider },
					context,
					options: sanitizeOptions(options),
				});
				return origStreamSimple(model, context, options);
			};
		}
	}

	/** Strip non-serializable fields (signal, callbacks) from options */
	function sanitizeOptions(options: unknown): unknown {
		if (!options || typeof options !== "object") return options;
		const copy: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
			if (typeof value === "function") continue;
			if (key === "signal") continue;
			copy[key] = value;
		}
		return copy;
	}
}
