import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { OcHttpError, parseOcRoute, statusForError } from "./oc-route.ts";
import { serveNativeFsmStream } from "./native-fsm-stream.ts";

export interface OcHandlers {
	roster(): unknown;
	statuses(): unknown;
	session(id: string): unknown;
	children(id: string): readonly unknown[];
	messages(id: string): readonly unknown[];
	createSession(body: unknown): Promise<unknown>;
	postMessage(id: string, body: unknown): Promise<unknown>;
	abort(id: string): Promise<true>;
	promptAsync(id: string, body: unknown): Promise<void>;
	launchAck?(body: unknown): unknown;
	agentMessage?(body: unknown): Promise<unknown>;
	nativeChild?(body: unknown, signal?: AbortSignal): Promise<unknown>;
	nativeFsm?(body: unknown, signal: AbortSignal, onProgress: (value: unknown) => void): Promise<unknown>;
}

const BODY_LIMIT = 1024 * 1024;

export class OcServer {
	private readonly server: Server;
	private readonly handlers: OcHandlers;
	private expectedDigest: Buffer | null = null;

	constructor(handlers: OcHandlers) {
		this.handlers = handlers;
		this.server = createServer((request, response) => {
			void this.handle(request, response);
		});
	}

	setPassword(password: string): void {
		if (!password) throw new RuntimeError("protocol-invalid");
		const header = Buffer.from(`opencode:${password}`).toString("base64");
		this.expectedDigest = createHash("sha256").update(header).digest();
	}

	async listen(): Promise<string> {
		if (!this.expectedDigest) throw new RuntimeError("not-ready");
		const address = await new Promise<{ address: string; port: number }>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(0, "127.0.0.1", () => {
				const bound = this.server.address();
				if (bound && typeof bound === "object") resolve({ address: bound.address, port: bound.port });
				else reject(new RuntimeError("transport-failed"));
			});
		});
		return `http://${address.address}:${address.port}`;
	}

	close(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.close((error) => { if (error) reject(error); else resolve(); });
			this.server.closeAllConnections?.();
		});
	}

	private authorized(header: string | undefined): boolean {
		// OC-parity: the loopback bridge accepts unauthenticated requests (wire7
		// analysis scripts and OC tooling send no credentials; the OC server has no
		// auth). Credentials, when present, must still be correct.
		if (!this.expectedDigest) return false;
		if (header === undefined || header === "") return true;
		if (!header.startsWith("Basic ")) return false;
		const actual = createHash("sha256").update(header.slice(6)).digest();
		return actual.length === this.expectedDigest.length && timingSafeEqual(actual, this.expectedDigest);
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const finish = (status: number, body?: unknown) => {
			if (response.destroyed) return;
			if (status === 204) { response.writeHead(204).end(); return; }
			response.writeHead(status, { "content-type": "application/json" });
			response.end(body === undefined ? "" : JSON.stringify(body));
		};
		try {
			if (!this.authorized(request.headers.authorization)) { finish(401, { error: "unauthorized" }); return; }
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/fsm-compatible/native-fsm" && request.method === "POST") {
				if (!this.handlers.nativeFsm) { finish(404); return; }
				const body = await this.readBody(request);
				return serveNativeFsmStream(response, (signal, progress) => this.handlers.nativeFsm!(body, signal, progress));
			}
			if (url.pathname === "/fsm-compatible/native-child" && request.method === "POST") {
				if (!this.handlers.nativeChild) { finish(404); return; }
				const controller = new AbortController();
				const cancel = () => { if (!response.writableFinished) controller.abort(); };
				response.once("close", cancel);
				try { return finish(200, await this.handlers.nativeChild(await this.readBody(request), controller.signal)); }
				catch (error) { finish(statusForError(error), { error: error instanceof Error ? error.message : "native request failed" }); return; }
				finally { response.off("close", cancel); }
			}
			if (url.pathname === "/fsm-compatible/agent-message" && request.method === "POST") {
				if (!this.handlers.agentMessage) { finish(404); return; }
				return finish(200, await this.handlers.agentMessage(await this.readBody(request)));
			}
			if (url.pathname === "/fsm-compatible/launch-ack" && request.method === "POST") {
				if (!this.handlers.launchAck) { finish(404); return; }
				return finish(200, this.handlers.launchAck(await this.readBody(request)));
			}
			const route = parseOcRoute(request.method ?? "", url.pathname);
			const body = request.method === "POST" ? await this.readBody(request) : undefined;
			if (route.kind === "roster") return finish(200, this.handlers.roster());
			if (route.kind === "status") return finish(200, this.handlers.statuses());
			if (route.kind === "create-session") return finish(200, await this.handlers.createSession(body));
			if (route.leaf === "meta") return finish(200, this.handlers.session(route.id));
			if (route.leaf === "children") return finish(200, this.handlers.children(route.id));
			if (route.leaf === "message") return finish(200, this.handlers.messages(route.id));
			if (route.leaf === "message-post") return finish(200, await this.handlers.postMessage(route.id, body));
			if (route.leaf === "abort") return finish(200, await this.handlers.abort(route.id));
			await this.handlers.promptAsync(route.id, body);
			return finish(204);
		} catch (error) {
			finish(statusForError(error));
		}
	}

	private readBody(request: IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let bytes = 0;
			let failed = false;
			request.on("data", (chunk: Buffer) => {
				bytes += chunk.length;
				if (bytes > BODY_LIMIT) {
					if (!failed) { failed = true; reject(new OcHttpError(413)); }
					return;
				}
				chunks.push(chunk);
			});
			request.on("end", () => {
				if (failed) return;
				if (chunks.length === 0) { resolve(undefined); return; }
				try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
				catch { reject(new OcHttpError(400)); }
			});
			request.on("error", () => { if (!failed) reject(new RuntimeError("transport-failed")); });
		});
	}
}
