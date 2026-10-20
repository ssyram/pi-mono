import { RuntimeError } from "../runtime/runtime-error.ts";

const BASE_TOOLS = ["read", "grep", "glob"] as const;
const EXTRA_TOOLS = ["bash", "edit", "webfetch", "websearch"] as const;
const DENY_ALIASES = new Set(["write", "apply_patch", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
const ALL_KNOWN = new Set<string>([...BASE_TOOLS, ...EXTRA_TOOLS, "external_directory", "StructuredOutput"]);

export interface JudgeToolPolicy {
	readonly allowed: ReadonlySet<string>;
	readonly externalDirectory: boolean;
}

export function resolveJudgeToolPolicy(tools: Readonly<Record<string, boolean>>): JudgeToolPolicy {
	// Step P3: wildcard deny with an explicit allow list; unknown names never enable anything.
	if (tools["*"] !== false) throw new RuntimeError("protocol-invalid");
	if (tools.StructuredOutput !== true) throw new RuntimeError("protocol-invalid");
	const allowed = new Set<string>(BASE_TOOLS);
	let externalDirectory = false;
	for (const [name, enabled] of Object.entries(tools)) {
		if (name === "*" || name === "StructuredOutput") continue;
		if (!ALL_KNOWN.has(name) || DENY_ALIASES.has(name)) {
			if (enabled) throw new RuntimeError("protocol-invalid");
			continue;
		}
		if (!enabled) continue;
		if (name === "external_directory") { externalDirectory = true; continue; }
		allowed.add(name);
	}
	return Object.freeze({ allowed, externalDirectory });
}
