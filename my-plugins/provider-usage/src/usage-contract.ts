import type { Api, Model } from "@earendil-works/pi-ai";

export type UsageModel = Model<Api>;

export interface Selection {
	sessionId: string;
	model: UsageModel;
	modelId: string;
	providerId: string;
	api: string;
	endpoint: string;
}

export type SupportedRouteKind = "codex" | "zai" | "zai-cn";

export type Route =
	| { kind: SupportedRouteKind; endpoint: string }
	| { kind: "unsupported" }
	| { kind: "error"; code: "invalid-response" };

export interface RequestAuth {
	route: SupportedRouteKind;
	endpoint: string;
	headers: Record<string, string>;
}

export type UsageErrorCode = "auth" | "timeout" | "network" | "http" | "invalid-response";

export type UsageResult =
	| { kind: "available"; text: string; compact: string }
	| { kind: "not-applicable" }
	| { kind: "unsupported" }
	| { kind: "error"; code: UsageErrorCode };

export type QueryResult = UsageResult | { kind: "cancelled" };

export type AuthResolution =
	| { kind: "ready"; auth: RequestAuth }
	| { kind: "cancelled" }
	| { kind: "unsupported" }
	| { kind: "error"; code: "auth" | "invalid-response" };

export type DisplayState =
	| { kind: "empty" }
	| { kind: "loading"; selection: Selection }
	| { kind: "ready"; selection: Selection; result: UsageResult; staleError?: UsageErrorCode };

export interface ResolvedModelAuth {
	ok: boolean;
	apiKey?: string;
	headers?: Record<string, string | null>;
	baseUrl?: string;
}

export interface UsageModelRegistry {
	getAll(): UsageModel[];
	getAvailable(): UsageModel[];
	getProvider(providerId: string): unknown;
	getApiKeyAndHeaders(model: UsageModel): Promise<ResolvedModelAuth>;
	isUsingOAuth(model: UsageModel): boolean;
}

export interface ContextUsageSnapshot {
	contextWindow: number;
	percent: number | null;
}
