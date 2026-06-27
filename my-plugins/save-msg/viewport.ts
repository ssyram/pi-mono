/**
 * Pure viewport-scroll math for the message picker.
 * Keeps the cursor visible AND keeps the visible window filled
 * (never scrolls past the last full page of rows).
 */

export function clampScrollOffset(
	scrollOffset: number,
	cursor: number,
	itemCount: number,
	maxVisible: number,
): number {
	const visible = Math.min(maxVisible, itemCount);
	let offset = scrollOffset;
	if (cursor < offset) offset = cursor;
	if (cursor >= offset + visible) offset = cursor - visible + 1;
	const maxOffset = Math.max(0, itemCount - visible);
	if (offset > maxOffset) offset = maxOffset;
	if (offset < 0) offset = 0;
	return offset;
}
