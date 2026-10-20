import { access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export interface InstallStep {
	readonly id: string;
	readonly description: string;
	status: "ready" | "blocked";
	readonly blocker?: string;
}

export interface InstallationPlan {
	readonly steps: readonly InstallStep[];
	readonly piConfigSuggestions: readonly string[];
	readonly fsmBinaryCheck: { readonly envVars: readonly string[]; readonly expected: { wire: 2; schema: 2 } };
	readonly modelRuntimeNote: string;
}

async function exists(path: string): Promise<boolean> {
	try { await access(path, constants.F_OK); return true; } catch { return false; }
}

/** Static, side-effect-free installation plan. Never writes ~/.pi or runs lifecycle scripts. */
export async function planInstallation(options?: { fsmServerPath?: string; fsmClientPath?: string }): Promise<InstallationPlan> {
	const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));
	const steps: InstallStep[] = [];
	const packageJson = join(pluginRoot, "package.json");
	steps.push((await exists(packageJson))
		? { id: "plugin-package", description: "plugin package.json present", status: "ready" }
		: { id: "plugin-package", description: "plugin package.json present", status: "blocked", blocker: packageJson });
	const sdkPackage = join(pluginRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
	steps.push((await exists(sdkPackage))
		? { id: "pi-sdk", description: "official Pi SDK 1.0.3 installed under plugin (npm install --ignore-scripts; overrides pin the @earendil-works set to 1.0.3)", status: "ready" }
		: { id: "pi-sdk", description: "official Pi SDK 1.0.3 installed under plugin", status: "blocked",
			blocker: `run npm install --ignore-scripts in ${pluginRoot}` });
	const helperSource = join(pluginRoot, "src", "runtime", "host-identity-macos.c");
	const ccAvailable = await exists("/usr/bin/cc");
	steps.push((await exists(helperSource) && ccAvailable)
		? { id: "identity-helper", description: "macOS identity helper source + /usr/bin/cc available; run npm run build:identity", status: "ready" }
		: { id: "identity-helper", description: "macOS identity helper build", status: "blocked",
			blocker: `need ${helperSource} and /usr/bin/cc (Xcode CLT)` });
	const configTemplate = join(pluginRoot, "fsm-compatible.config.json");
	steps.push({ id: "config", description: "create fsm-compatible.config.json next to package.json "
		+ "(dataDir, clientCommand/clientArgs pointing at the wire-2 FSM client, cwd, capacity, timeoutMs, modelSource)",
		status: (await exists(configTemplate)) ? "ready" : "blocked", ...(await exists(configTemplate) ? {} : { blocker: configTemplate }) });
	const server = options?.fsmServerPath ?? process.env.FSM_COMPATIBLE_TEST_SERVER ?? "";
	const client = options?.fsmClientPath ?? process.env.FSM_COMPATIBLE_TEST_CLIENT ?? "";
	steps.push({ id: "managed-bootstrap", description: "current entry registers the single built-in factory; "
		+ "companion-factory manifest generation (top-level static imports) is a post-core install enhancement", status: "ready" });
	steps.push((server && client)
		? { id: "fsm-binaries", description: "FSM server/client paths supplied; verify wire 2 via capabilities before use", status: "ready" }
		: { id: "fsm-binaries", description: "FSM server/client paths not supplied", status: "blocked",
			blocker: "set fsmServerPath/fsmClientPath (installed ~/bin binary reports 0.10.0 without wire_contract_version; use the 0.11.0/wire2 build)" });
	return {
		steps: Object.freeze(steps),
		piConfigSuggestions: [
			`add "${pluginRoot.replace(/\/package\.json$/, "")}/src/index.ts" to the project .pi extension list (manual step; this plan never edits ~/.pi)`,
			"ensure pi-subagents is present for structured delegation (child gates require it)",
			"ensure the FSM daemon is running and FSM_DATA_DIR matches fsm-compatible.config.json dataDir",
		],
		fsmBinaryCheck: { envVars: Object.freeze(["FSM_COMPATIBLE_TEST_SERVER", "FSM_COMPATIBLE_TEST_CLIENT"]),
			expected: Object.freeze({ wire: 2, schema: 2 }) },
		modelRuntimeNote: "judge sessions need a configured model with credentials; real provider usage requires explicit account/budget authorization",
	};
}
