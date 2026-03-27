/**
 * Shared formatting utilities for background job tools.
 */

export function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleTimeString();
}

export function formatDuration(startMs: number, endMs?: number): string {
	const elapsed = (endMs ?? Date.now()) - startMs;
	if (elapsed < 1000) return `${elapsed}ms`;
	if (elapsed < 60_000) return `${(elapsed / 1000).toFixed(1)}s`;
	return `${(elapsed / 60_000).toFixed(1)}m`;
}
