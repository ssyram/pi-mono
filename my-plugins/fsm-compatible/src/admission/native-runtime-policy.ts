import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdmissionPolicy, PolicyInput } from "./admission-policy.ts";
import { buildAdmissionPolicy } from "./build-admission-policy.ts";
import { narrowAdmissionPolicy } from "./narrow-admission-policy.ts";
import { parsePolicyInput } from "./parse-policy-input.ts";

const ENTRY = "fsm-compatible:native-policy";

export function nativeRuntimePolicy(pi: ExtensionAPI, ctx: ExtensionContext, input: PolicyInput): AdmissionPolicy {
	const extensions = input.requiredExtensions.map((item) => ({ ...item, requireForAllRunners: true as const }));
	const definitions = input.allowedAgentNames.map((name) => ({ canonicalName: name, runtimeName: name,
		runnerType: "pi", definitionSnapshot: { name }, declaredToolCeiling: null }));
	let built = buildAdmissionPolicy(input, definitions, extensions);
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
		const saved = parsePolicyInput(entry.data);
		if (!saved.ok) throw new Error("invalid persisted native policy");
		const previous = buildAdmissionPolicy(saved.value, saved.value.allowedAgentNames.map((name) => ({
			canonicalName: name, runtimeName: name, runnerType: "pi", definitionSnapshot: { name }, declaredToolCeiling: null,
		})), saved.value.requiredExtensions.map((item) => ({ ...item, requireForAllRunners: true as const })));
		if (!previous.ok) throw new Error("invalid persisted native policy");
		built = narrowAdmissionPolicy(previous.value, input, extensions);
		if (!built.ok) throw new Error(`native policy restore rejected: ${built.code}`);
	}
	if (!built.ok) throw new Error(`invalid native policy: ${built.code}`);
	pi.appendEntry(ENTRY, input);
	return built.value;
}
