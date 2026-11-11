/** Format epoch milliseconds as a local `YYYY-MM-DD HH:MM` timestamp for usage displays. */
export function formatLocalTime(ms: number): string {
	const date = new Date(ms);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
