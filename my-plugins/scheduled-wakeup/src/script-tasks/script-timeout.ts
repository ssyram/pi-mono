const MAX_TIMEOUT_MS = 2_147_483_647;

export function armScriptTimeout(
	seconds: number | null,
	onTimeout: () => void,
): () => void {
	if (seconds === null) return () => {};
	let remaining = seconds * 1000;
	let cancelled = false;
	let timer: ReturnType<typeof setTimeout>;
	const arm = (): void => {
		const slice = Math.min(remaining, MAX_TIMEOUT_MS);
		timer = setTimeout(() => {
			if (cancelled) return;
			remaining -= slice;
			if (remaining > 0) arm();
			else onTimeout();
		}, slice);
	};
	arm();
	return () => {
		cancelled = true;
		clearTimeout(timer);
	};
}
