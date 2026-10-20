import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
	FSM_COMPATIBLE_EXTENSION_ID,
	MAX_REQUIRED_EXTENSIONS,
	REQUIRED_EXTENSION_ID_PATTERN,
	type RequiredExtension,
	type RequiredExtensionInput,
} from "./admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "./admission-result.ts";
import { isAdmissionIdentifier } from "./parse-policy-input.ts";

export interface ExtensionFiles {
	realpath(path: string): string;
	isFile(path: string): boolean;
}

export const localExtensionFiles: ExtensionFiles = Object.freeze({
	realpath: realpathSync,
	isFile: (path: string) => statSync(path).isFile(),
});

export function canonicalizeRequiredExtensions(
	input: readonly RequiredExtensionInput[],
	selfPath: string,
	files: ExtensionFiles = localExtensionFiles,
): AdmissionResult<readonly RequiredExtension[]> {
	// Step P2: inspect files without importing or executing any extension.
	try {
		const self = files.realpath(selfPath);
		if (!isAdmissionIdentifier(self) || !isAbsolute(self) || !files.isFile(self)) return rejected("required-extension-mismatch");
		const ids = new Set<string>();
		const paths = new Set<string>();
		const result: RequiredExtension[] = [];
		for (const entry of input) {
			if (!REQUIRED_EXTENSION_ID_PATTERN.test(entry.id) || !isAdmissionIdentifier(entry.path)) return rejected("required-extension-mismatch");
			const path = files.realpath(entry.path);
			if (!isAdmissionIdentifier(path) || !isAbsolute(path) || !files.isFile(path) || ids.has(entry.id) || paths.has(path)) {
				return rejected("required-extension-mismatch");
			}
			if (entry.id === FSM_COMPATIBLE_EXTENSION_ID && path !== self) return rejected("required-extension-mismatch");
			ids.add(entry.id);
			paths.add(path);
			result.push(Object.freeze({ id: entry.id, path, requireForAllRunners: true }));
		}
		if (!ids.has(FSM_COMPATIBLE_EXTENSION_ID)) {
			if (paths.has(self)) return rejected("required-extension-mismatch");
			result.push(Object.freeze({ id: FSM_COMPATIBLE_EXTENSION_ID, path: self, requireForAllRunners: true }));
		}
		if (result.length > MAX_REQUIRED_EXTENSIONS) return rejected("required-extension-mismatch");
		return admitted(Object.freeze(result));
	} catch {
		return rejected("required-extension-mismatch");
	}
}
