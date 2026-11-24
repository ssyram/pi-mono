/** Managed new-api admin session: cookie + New-Api-User, bounded requests, one 401 re-auth. */
import { backendFailure, type BackendResult } from "./backend-failure.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface Envelope {
	success?: unknown;
	message?: unknown;
	data?: unknown;
}

export interface NewApiSession {
	authenticate(signal: AbortSignal): Promise<BackendResult<void>>;
	read(path: string, signal: AbortSignal): Promise<BackendResult<unknown>>;
	write(method: "POST" | "PUT", path: string, body: JsonValue, signal: AbortSignal): Promise<BackendResult<unknown>>;
	readonly userId: number | undefined;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createNewApiSession(origin: string, username: string, password: string): NewApiSession {
	let cookie: string | undefined;
	let userId: number | undefined;

	async function request(
		path: string,
		init: { method: string; body?: string },
		signal: AbortSignal,
	): Promise<{ status: number; envelope: Envelope | undefined } | "network"> {
		if (signal.aborted) return "network";
		let response: Response;
		try {
			response = await fetch(`${origin}${path}`, {
				method: init.method,
				headers: {
					...(init.body ? { "content-type": "application/json" } : {}),
					...(cookie ? { cookie } : {}),
					...(userId !== undefined ? { "new-api-user": String(userId) } : {}),
				},
				...(init.body ? { body: init.body } : {}),
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
			});
		} catch {
			return "network";
		}
		if (response.status === 204) return { status: 204, envelope: undefined };
		let envelope: Envelope | undefined;
		try {
			envelope = (await response.json()) as Envelope;
		} catch {
			envelope = undefined;
		}
		if (response.status === 401) {
			const setCookie = response.headers.getSetCookie?.() ?? [];
			cookie = setCookie.length > 0 ? setCookie.map((line) => line.split(";", 1)[0]).join("; ") : cookie;
		}
		return { status: response.status, envelope };
	}

	function parseEnvelope(result: { status: number; envelope: Envelope | undefined }): BackendResult<unknown> {
		if (result.envelope === undefined || result.envelope.success !== true) {
			return backendFailure("invalid-response", "new-api envelope", result.status);
		}
		return { kind: "ok", value: result.envelope.data };
	}

	async function runWithReauth(
		path: string,
		method: "GET" | "POST" | "PUT",
		body: string | undefined,
		signal: AbortSignal,
	): Promise<BackendResult<unknown>> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await request(path, { method, body }, signal);
			if (result === "network") {
				return signal.aborted
					? { kind: "cancelled" }
					: backendFailure(method === "GET" ? "network" : "ambiguous-write", path);
			}
			if (result.status === 401 && attempt === 0) {
				const reauth = await reauthenticate(signal);
				if (reauth.kind !== "ok") return reauth;
				continue;
			}
			if (result.status === 401) return backendFailure("management-auth", path, 401);
			return parseEnvelope(result);
		}
		return backendFailure("management-auth", path);
	}

	async function reauthenticate(signal: AbortSignal): Promise<BackendResult<void>> {
		cookie = undefined;
		userId = undefined;
		let response: Response;
		try {
			response = await fetch(`${origin}/api/user/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username, password }),
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
			});
		} catch {
			return signal.aborted ? { kind: "cancelled" } : backendFailure("management-auth", "login unreachable");
		}
		if (response.status === 401) {
			const data = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
			const message = typeof data?.message === "string" ? data.message : "";
			return backendFailure("management-auth", message.includes("2FA") ? "login requires 2FA" : "login rejected", 401);
		}
		if (!response.ok) return backendFailure("management-auth", "login http", response.status);
		let envelope: Envelope;
		try {
			envelope = (await response.json()) as Envelope;
		} catch {
			return backendFailure("invalid-response", "login reply");
		}
		if (envelope.success !== true) return backendFailure("management-auth", "login rejected");
		const data = envelope.data as { id?: unknown } | null;
		if (typeof data?.id !== "number") return backendFailure("invalid-response", "login user id");
		const setCookie = response.headers.getSetCookie?.() ?? [];
		if (setCookie.length === 0) return backendFailure("invalid-response", "login session cookie");
		cookie = setCookie.map((line) => line.split(";", 1)[0]).join("; ");
		userId = data.id;
		return { kind: "ok", value: undefined };
	}

	return {
		get userId() {
			return userId;
		},
		authenticate: reauthenticate,
		read: (path, signal) => runWithReauth(path, "GET", undefined, signal),
		write: (method, path, body, signal) => runWithReauth(path, method, JSON.stringify(body), signal),
	};
}
