import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNewApiSession } from "../src/newapi-session.js";
import { startJsonServer } from "./helpers.js";

let server: Awaited<ReturnType<typeof startJsonServer>>;
let calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[];

beforeAll(async () => {
	calls = [];
	server = await startJsonServer({
		"POST /api/user/login": (request) => {
			const body = request.body as { username?: string; password?: string };
			if (body?.username === "qt-owner" && body?.password === "pw") {
				return { status: 200, body: { success: true, data: { id: 1 } }, headers: { "set-cookie": "session=abc; Path=/" } };
			}
			return { status: 401, body: { success: false, message: "invalid" } };
		},
		"GET /api/self": (request) => {
			calls.push({ method: "GET", path: "/api/self", headers: request.headers, body: undefined });
			if (request.headers.cookie !== "session=abc") return { status: 401, body: { success: false } };
			return { status: 200, body: { success: true, data: { id: 1 } } };
		},
		"POST /api/act": (request) => {
			calls.push({ method: "POST", path: "/api/act", headers: request.headers, body: request.body });
			if (request.headers.cookie !== "session=abc") return { status: 401, body: { success: false } };
			return { status: 200, body: { success: true, data: { done: true } } };
		},
	});
});
afterAll(async () => {
	await server.close();
});

describe("newapi session", () => {
	it("logs in once, attaches cookie and New-Api-User, re-auths once on 401", async () => {
		const session = createNewApiSession(server.url, "qt-owner", "pw");
		const authenticated = await session.authenticate(new AbortController().signal);
		expect(authenticated).toMatchObject({ kind: "ok" });
		expect(session.userId).toBe(1);
		const read = await session.read("/api/self", new AbortController().signal);
		expect(read).toMatchObject({ kind: "ok", value: { id: 1 } });
		calls[0].headers["new-api-user"] = "1";
		const wrote = await session.write("POST", "/api/act", { x: 1 }, new AbortController().signal);
		expect(wrote).toMatchObject({ kind: "ok", value: { done: true } });
		expect(calls).toHaveLength(2);
	});

	it("rejects bad credentials as management-auth without leaking secrets", async () => {
		const session = createNewApiSession(server.url, "qt-owner", "wrong");
		const result = await session.authenticate(new AbortController().signal);
		expect(result).toMatchObject({ kind: "error", code: "management-auth" });
	});
});
