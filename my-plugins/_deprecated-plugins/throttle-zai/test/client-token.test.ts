import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientTokenName, ensureClientToken } from "../src/client-token.js";
import { createNewApiSession } from "../src/newapi-session.js";

const root = await mkdtemp(join(tmpdir(), "throttle-zai-token-"));

const tokens = new Map<number, Record<string, unknown>>();
let nextId = 1;
let createCalls = 0;
let failCreate = false;
let keyResponder: (id: number) => { status: number; body?: unknown } = () => ({ status: 500, body: { success: false } });

const server = createServer((request, response) => {
	const chunks: Buffer[] = [];
	request.on("data", (chunk: Buffer) => chunks.push(chunk));
	request.on("end", () => {
		const raw = Buffer.concat(chunks).toString("utf-8");
		const body = raw === "" ? undefined : JSON.parse(raw);
		const send = (status: number, payload?: unknown, headers?: Record<string, string>): void => {
			response.writeHead(status, { "content-type": "application/json", ...(headers ?? {}) });
			response.end(payload === undefined ? "" : JSON.stringify(payload));
		};
		const path = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
		if (path === "/api/user/login" && request.method === "POST") {
			send(200, { success: true, data: { id: 1 } }, { "set-cookie": "session=s; Path=/" });
		} else if (path === "/api/token/" && request.method === "GET") {
			const items = [...tokens.values()].map((token) => ({ ...token, key: "masked" }));
			send(200, { success: true, data: { items, total: items.length } });
		} else if (path === "/api/token/" && request.method === "POST") {
			createCalls++;
			if (failCreate) return send(500, { success: false });
			const id = nextId++;
			tokens.set(id, { id, name: (body as { name?: string })?.name ?? "", status: 1, group: "default", unlimited_quota: true, expired_time: -1 });
			send(200, { success: true, message: "" });
		} else if (/^\/api\/token\/(\d+)$/.test(path) && request.method === "GET") {
			const id = Number(path.split("/")[3]);
			const token = tokens.get(id);
			if (!token) return send(200, { success: false, message: "not found" });
			send(200, { success: true, data: token });
		} else if (/^\/api\/token\/(\d+)\/key$/.test(path) && request.method === "POST") {
			const result = keyResponder(Number(path.split("/")[3]));
			send(result.status, result.body);
		} else {
			send(404, { error: "not found" });
		}
	});
});

beforeAll(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)));
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function url(): string {
	const address = server.address();
	return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

async function freshSession() {
	const created = createNewApiSession(url(), "qt-owner", "pw");
	await created.authenticate(new AbortController().signal);
	return created;
}

describe("client token", () => {
	it("derives a stable 35-char name", () => {
		expect(clientTokenName("inst", "my-zai")).toBe(clientTokenName("inst", "my-zai"));
		expect(clientTokenName("inst", "my-zai")).toHaveLength(35);
		expect(clientTokenName("inst", "other")).not.toBe(clientTokenName("inst", "my-zai"));
	});

	it("adopts an existing unique token without creating one", async () => {
		const name = clientTokenName("inst-a", "my-zai");
		const id = nextId++;
		tokens.set(id, { id, name, status: 1, group: "default", unlimited_quota: true, expired_time: -1 });
		keyResponder = (tokenId) => sendOk({ key: `sk-${tokenId}` });
		const result = await ensureClientToken("inst-a", "my-zai", root, await freshSession(), new AbortController().signal);
		expect(result).toMatchObject({ kind: "ok", value: `sk-${id}` });
		expect(createCalls).toBe(0);
	});

	it("creates with intent journal, resolves id, fetches full key, reuses journal", async () => {
		failCreate = false;
		keyResponder = (tokenId) => sendOk({ key: `sk-full-${tokenId}` });
		const before = createCalls;
		const first = await ensureClientToken("inst-b", "my-zai", root, await freshSession(), new AbortController().signal);
		expect(first.kind).toBe("ok");
		expect(createCalls).toBe(before + 1);
		const second = await ensureClientToken("inst-b", "my-zai", root, await freshSession(), new AbortController().signal);
		expect(second).toEqual(first);
		expect(createCalls).toBe(before + 1);
	});

	it("maps a failed creation to ambiguous-write and refuses blind replay", async () => {
		failCreate = true;
		const journalRoot = join(root, "clients-b");
		const result = await ensureClientToken("inst-c", "my-zai", journalRoot, await freshSession(), new AbortController().signal);
		expect(result).toMatchObject({ kind: "error", code: "ambiguous-write" });
		failCreate = false;
		const retry = await ensureClientToken("inst-c", "my-zai", journalRoot, await freshSession(), new AbortController().signal);
		if (retry.kind === "ok") throw new Error("uncertain journal must not silently mint a token");
		expect(retry).toMatchObject({ kind: "error", code: "operation-uncertain" });
	});

	it("reports disabled tokens instead of auto-enabling", async () => {
		const name = clientTokenName("inst-d", "my-zai");
		const id = nextId++;
		tokens.set(id, { id, name, status: 2, group: "default", unlimited_quota: true, expired_time: -1 });
		const result = await ensureClientToken("inst-d", "my-zai", root, await freshSession(), new AbortController().signal);
		expect(result).toMatchObject({ kind: "error", code: "client-disabled" });
	});
});

function sendOk(data: unknown): { status: number; body?: unknown } {
	return { status: 200, body: { success: true, data } };
}
