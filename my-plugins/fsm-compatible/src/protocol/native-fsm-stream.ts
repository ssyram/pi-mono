import type { ServerResponse } from "node:http";
import { statusForError } from "./oc-route.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

export async function serveNativeFsmStream(response: ServerResponse,
	operation: (signal: AbortSignal, progress: (value: unknown) => void) => Promise<unknown>): Promise<void> {
	const controller = new AbortController();
	const cancel = () => { if (!response.writableFinished) controller.abort(); };
	response.once("close", cancel);
	const frame = (value: unknown) => {
		if (response.destroyed) return;
		if (!response.headersSent) response.writeHead(200, { "content-type": "application/x-ndjson" });
		response.write(`${JSON.stringify(value)}\n`);
	};
	try {
		const value = await operation(controller.signal, (progress) => frame({ type: "progress", value: progress }));
		frame({ type: "result", value }); response.end();
	} catch (error) {
		if (!response.destroyed) {
			const message = error instanceof Error ? error.message : "native FSM request failed";
			if (!response.headersSent) {
				response.writeHead(statusForError(error), { "content-type": "application/json" }); response.end(JSON.stringify({ error: message }));
			} else { frame({ type: "error", code: error instanceof RuntimeError ? error.code : "transport-failed", message }); response.end(); }
		}
	} finally { response.off("close", cancel); }
}
