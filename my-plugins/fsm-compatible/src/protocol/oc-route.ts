import { RuntimeError } from "../runtime/runtime-error.ts";

export class OcHttpError extends Error {
	readonly status: number;
	constructor(status: number) {
		super(`oc-http-${status}`);
		this.status = status;
	}
}

export type OcRoute =
	| { readonly kind: "roster" }
	| { readonly kind: "status" }
	| { readonly kind: "create-session" }
	| { readonly kind: "session"; readonly id: string; readonly leaf: "meta" | "children" | "message" | "message-post" | "abort" | "prompt-async" };

function decodeSegment(segment: string): string {
	if (segment.includes("%")) {
		try { segment = decodeURIComponent(segment); } catch { throw new OcHttpError(404); }
	}
	if (!segment) throw new OcHttpError(404);
	return segment;
}

export function parseOcRoute(method: string, pathname: string): OcRoute {
	if (pathname === "/session") {
		if (method === "GET") return { kind: "roster" };
		if (method === "POST") return { kind: "create-session" };
		throw new OcHttpError(405);
	}
	if (pathname === "/session/status") {
		if (method !== "GET") throw new OcHttpError(405);
		return { kind: "status" };
	}
	const segments = pathname.split("/").filter((segment) => segment.length > 0);
	if (segments[0] !== "session" || segments.length < 2) throw new OcHttpError(404);
	const id = decodeSegment(segments[1]!);
	const leaf = segments.length === 2 ? "meta" : `${segments[2]}`;
	if (segments.length > 3) throw new OcHttpError(404);
	if (leaf === "meta" && method === "GET") return { kind: "session", id, leaf: "meta" };
	if (leaf === "children" && method === "GET" && segments.length === 3) return { kind: "session", id, leaf: "children" };
	if (leaf === "message" && segments.length === 3) {
		return { kind: "session", id, leaf: method === "GET" ? "message" : method === "POST" ? "message-post" : (() => { throw new OcHttpError(405); })() };
	}
	if (leaf === "abort" && method === "POST" && segments.length === 3) return { kind: "session", id, leaf: "abort" };
	if (leaf === "prompt_async" && method === "POST" && segments.length === 3) return { kind: "session", id, leaf: "prompt-async" };
	throw new OcHttpError(404);
}

export function statusForError(error: unknown): number {
	if (error instanceof OcHttpError) return error.status;
	if (error instanceof RuntimeError) {
		if (error.code === "not-ready" || error.code === "owner-unavailable" || error.code === "queue-full"
			|| error.code === "deadline-exceeded" || error.code === "transport-failed" || error.code === "protocol-invalid") return 503;
		return 500;
	}
	return 500;
}
