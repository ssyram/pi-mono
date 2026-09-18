const DAY_MS = 86_400_000;

export function parseAtTime(value: string, now = new Date()): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const parsed = Date.parse(trimmed);
	if (Number.isFinite(parsed) && parsed > now.getTime()) return parsed;

	const clock = parseClockExpression(trimmed, now);
	return clock !== undefined && clock > now.getTime() ? clock : undefined;
}

function parseClockExpression(value: string, now: Date): number | undefined {
	const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(today|tomorrow))?(?:\s+(local|utc|z|[+-]\d{2}:?\d{2}))?$/i.exec(value);
	if (!match) return undefined;

	const hourText = match[1];
	const minuteText = match[2] ?? "00";
	const meridiem = match[3]?.toLowerCase();
	const dayText = match[4]?.toLowerCase();
	const zoneText = match[5]?.toLowerCase();
	if (!hourText) return undefined;

	const hour = normalizeHour(Number.parseInt(hourText, 10), meridiem);
	const minute = Number.parseInt(minuteText, 10);
	if (hour === undefined || !Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;

	const dayOffset = dayText === "tomorrow" ? 1 : 0;
	if (zoneText === undefined || zoneText === "local") return localTime(now, dayOffset, hour, minute);

	const offsetMinutes = zoneOffsetMinutes(zoneText);
	if (offsetMinutes === undefined) return undefined;
	return zonedTime(now, dayOffset, hour, minute, offsetMinutes);
}

function normalizeHour(hour: number, meridiem: string | undefined): number | undefined {
	if (!Number.isInteger(hour)) return undefined;
	if (meridiem === undefined) return hour >= 0 && hour <= 23 ? hour : undefined;
	if (hour < 1 || hour > 12) return undefined;
	if (meridiem === "am") return hour === 12 ? 0 : hour;
	return hour === 12 ? 12 : hour + 12;
}

function localTime(now: Date, dayOffset: number, hour: number, minute: number): number {
	const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);
	return date.getTime();
}

function zonedTime(now: Date, dayOffset: number, hour: number, minute: number, offsetMinutes: number): number {
	const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hour, minute, 0, 0);
	return base - offsetMinutes * 60_000;
}

function zoneOffsetMinutes(value: string): number | undefined {
	if (value === "utc" || value === "z") return 0;
	const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
	if (!match) return undefined;
	const hours = Number.parseInt(match[2] ?? "", 10);
	const minutes = Number.parseInt(match[3] ?? "", 10);
	if (hours > 23 || minutes > 59) return undefined;
	const sign = match[1] === "-" ? -1 : 1;
	return sign * (hours * 60 + minutes);
}
