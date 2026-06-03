/**
 * Background scan + cache for discovered extensions.
 * First invocation starts scan; subsequent invocation can open UI once result is ready.
 */

import type { DiscoveredExtension, ScanProgress } from "./discover-extensions.js";

export interface ScanResult {
	cwd: string;
	globalDir: string;
	extensions: DiscoveredExtension[];
	scanTime: number;
	error: string | null;
}

let scanPromise: Promise<ScanResult> | null = null;
let cachedResult: ScanResult | null = null;
let currentProgress: ScanProgress | null = null;

export function startBackgroundScan(
	cwd: string,
	globalDir: string,
	scanFn: (onProgress?: (progress: ScanProgress) => void) => DiscoveredExtension[],
): Promise<ScanResult> {
	if (cachedResult && cachedResult.cwd === cwd && cachedResult.globalDir === globalDir) {
		return Promise.resolve(cachedResult);
	}

	if (scanPromise) {
		return scanPromise.then((result) => {
			if (result.cwd === cwd && result.globalDir === globalDir) return result;
			return startNewScan(cwd, globalDir, scanFn);
		});
	}

	return startNewScan(cwd, globalDir, scanFn);
}

export function isScanComplete(cwd: string, globalDir: string): boolean {
	return !!cachedResult && cachedResult.cwd === cwd && cachedResult.globalDir === globalDir;
}

export function getCachedResult(cwd: string, globalDir: string): ScanResult | null {
	if (!cachedResult) return null;
	return cachedResult.cwd === cwd && cachedResult.globalDir === globalDir ? cachedResult : null;
}

export function getCurrentProgress(): ScanProgress | null {
	return currentProgress;
}

export function getScanPromise(): Promise<ScanResult> | null {
	return scanPromise;
}

export function clearCache(): void {
	scanPromise = null;
	cachedResult = null;
	currentProgress = null;
}

function startNewScan(
	cwd: string,
	globalDir: string,
	scanFn: (onProgress?: (progress: ScanProgress) => void) => DiscoveredExtension[],
): Promise<ScanResult> {
	const start = Date.now();
	currentProgress = {
		phase: "loading-repos",
		repoName: null,
		repoIndex: 0,
		repoCount: 0,
		entryName: null,
		entryIndex: 0,
		entryCount: 0,
	};
	const promise = new Promise<ScanResult>((resolvePromise) => {
		const doScan = () => {
			let result: ScanResult;
			try {
				const extensions = scanFn((progress) => {
					currentProgress = progress;
				});
				result = { cwd, globalDir, extensions, scanTime: Date.now() - start, error: null };
			} catch (error) {
				result = {
					cwd,
					globalDir,
					extensions: [],
					scanTime: Date.now() - start,
					error: error instanceof Error ? error.message : String(error),
				};
			}
			cachedResult = result;
			currentProgress = {
				phase: "done",
				repoName: null,
				repoIndex: result.extensions.length > 0 ? currentProgress?.repoCount ?? 0 : currentProgress?.repoIndex ?? 0,
				repoCount: currentProgress?.repoCount ?? 0,
				entryName: null,
				entryIndex: 0,
				entryCount: 0,
			};
			scanPromise = null;
			resolvePromise(result);
		};

		if (typeof setImmediate === "function") setImmediate(doScan);
		else setTimeout(doScan, 0);
	});

	scanPromise = promise;
	return promise;
}
