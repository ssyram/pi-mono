import { createServer, type Server } from "node:http";

export interface FakeServer {
	server: Server;
	url: string;
	close(): Promise<void>;
}

/** Registers exact-path JSON handlers; unmatched paths 404. */
export function startJsonServer(
	handlers: Record<string, (request: { body: unknown; headers: Record<string, string> }) => { status: number; body?: unknown; headers?: Record<string, string> }>,
): Promise<FakeServer> {
	return new Promise((resolve) => {
		const server = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				let body: unknown;
				try {
					body = raw === "" ? undefined : JSON.parse(raw);
				} catch {
					body = raw;
				}
				const handler = handlers[`${request.method} ${request.url}`];
				const result = handler
					? handler({ body, headers: request.headers as Record<string, string> })
					: { status: 404, body: { error: "not found" } };
				const payload = result.body === undefined ? "" : JSON.stringify(result.body);
				response.writeHead(result.status, {
					"content-type": "application/json",
					...(result.headers ?? {}),
				});
				response.end(payload);
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
			resolve({ server, url, close: () => new Promise((done) => server.close(() => done())) });
		});
	});
}

export interface Bus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export function fakeBus(): Bus {
	const handlers = new Map<string, ((data: unknown) => void)[]>();
	return {
		emit(channel, data) {
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
		on(channel, handler) {
			const list = handlers.get(channel) ?? [];
			list.push(handler);
			handlers.set(channel, list);
			return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((item) => item !== handler));
		},
	};
}

export function loopbackUrls(): { controlUrl: string; relayOrigin: string } {
	return { controlUrl: "http://127.0.0.1:1", relayOrigin: "http://127.0.0.1:2" };
}
