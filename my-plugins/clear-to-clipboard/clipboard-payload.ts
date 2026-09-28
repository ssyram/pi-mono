const PASTE_MARKER = /\[paste #(\d+)(?: (?:\+\d+ lines|\d+ chars))?\]/g;

export function formatClipboardPayload(raw: string, pastes: ReadonlyMap<number, unknown>): string {
	return raw.replace(PASTE_MARKER, (marker, id: string) => {
		const content = pastes.get(Number(id));
		return typeof content === "string" ? `[paste#${id}-- ${content} ##]` : marker;
	});
}
