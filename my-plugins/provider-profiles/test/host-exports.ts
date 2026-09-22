/** Test-context re-export of the host agent-dir resolver. The production
 * extension imports the same function from "@earendil-works/pi-coding-agent"
 * (resolved via VIRTUAL_MODULES in the real pi runtime); vitest cannot import
 * the full package entry, so this routes to the workspace source directly. */
export { getAgentDir } from "../../../packages/coding-agent/src/config.ts";
