import type { UsageModel, UsageModelRegistry } from "./usage-contract.js";

export type TargetResolution =
	| { kind: "targets"; models: UsageModel[]; unknown: string[]; showToAi: boolean }
	| { kind: "error"; message: string };

export const SHOW_TO_AI_FLAG = "--show-to-ai";

export function resolveUsageTargets(
	args: string,
	current: UsageModel | undefined,
	registry: Pick<UsageModelRegistry, "getAll" | "getAvailable">,
): TargetResolution {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const showToAi = tokens.includes(SHOW_TO_AI_FLAG);
	const names = tokens.filter((name) => name !== SHOW_TO_AI_FLAG);
	if (current?.provider === "unknown" && current.id === "unknown" && current.api === "unknown") current = undefined;
	if (names.includes("--all") && names.length !== 1) return { kind: "error", message: "--all 不能与账号名称混用" };
	if (names.some((name) => name.startsWith("-") && name !== "--all")) {
		return { kind: "error", message: "用法：/provider-usage [--show-to-ai] [--all | provider-name ...]" };
	}
	if (names.length === 0) {
		return current
			? { kind: "targets", models: [current], unknown: [], showToAi }
			: { kind: "error", message: "没有当前 provider" };
	}
	const candidates = names[0] === "--all" ? registry.getAvailable() : registry.getAll();
	const available = new Map<string, UsageModel>();
	if (current) available.set(current.provider, current);
	for (const model of candidates) if (!available.has(model.provider)) available.set(model.provider, model);
	if (names[0] === "--all") return { kind: "targets", models: [...available.values()], unknown: [], showToAi };
	const models: UsageModel[] = [];
	const unknown: string[] = [];
	for (const name of new Set(names)) {
		const model = available.get(name);
		if (model) models.push(model);
		else unknown.push(name);
	}
	return { kind: "targets", models, unknown, showToAi };
}
