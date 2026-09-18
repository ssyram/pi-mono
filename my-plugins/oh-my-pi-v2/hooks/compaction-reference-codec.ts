import type { CompactionReferenceState } from "./compaction-reference-state.js";

interface ParsedReference {
	first: number;
	last: number;
	sliced: boolean;
	start: number | undefined;
	end: number | undefined;
}

export function formatCompactionReference(ordinal: number): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1)
		throw new RangeError("Expected a positive safe ordinal");
	return `@!${ordinal}@`;
}

export function escapeCompactionReferenceLiterals(text: string): string {
	return text.replace(/@(\|*)!/g, "@$1|!");
}

function parseReference(expression: string): ParsedReference | undefined {
	if (expression.length > 256) return undefined;
	const slice = /^(.*?)\[(-?\d+)?(?::|\.\.)(-?\d+)?\]$/.exec(expression);
	if (slice && slice[0] !== expression) return undefined;
	let base = slice ? slice[1] : expression;
	if (base.startsWith("(")) {
		if (!slice || !/^\([1-9]\d*~[1-9]\d*\)$/.test(base)) return undefined;
		base = base.slice(1, -1);
	} else if (slice && base.includes("~")) {
		return undefined;
	}
	const ids = /^([1-9]\d*)(?:~([1-9]\d*))?$/.exec(base);
	if (!ids || ids[0] !== base) return undefined;
	return {
		first: Number(ids[1]),
		last: Number(ids[2] ?? ids[1]),
		sliced: slice !== null,
		start: slice?.[2] === undefined ? undefined : Number(slice[2]),
		end: slice?.[3] === undefined ? undefined : Number(slice[3]),
	};
}

function resolveReference(
	state: CompactionReferenceState,
	reference: ParsedReference,
): string | undefined {
	const { first, last } = reference;
	if (
		!Number.isSafeInteger(first) ||
		!Number.isSafeInteger(last) ||
		first > last
	)
		return undefined;
	if (last > state.sources.length) return undefined;
	const document = state.sources[first - 1].document;
	const parts: string[] = [];
	for (let ordinal = first; ordinal <= last; ordinal++) {
		const source = state.sources[ordinal - 1];
		if (source.document !== document) return undefined;
		parts.push(source.text);
	}
	const text = parts.join("");
	if (!reference.sliced) return text;
	const points = Array.from(text);
	let start = reference.start ?? 0;
	let end = reference.end ?? points.length;
	if (start < 0) start += points.length;
	if (end < 0) end += points.length;
	start = Math.max(0, Math.min(points.length, start));
	end = Math.max(0, Math.min(points.length, end));
	return points.slice(start, end).join("");
}

export function expandCompactionReferences(
	state: CompactionReferenceState,
	draft: string,
): string {
	const output: string[] = [];
	let offset = 0;
	while (offset < draft.length) {
		if (draft[offset] !== "@") {
			const start = offset;
			while (offset < draft.length && draft[offset] !== "@") offset++;
			output.push(draft.slice(start, offset));
			continue;
		}
		let pipeEnd = offset + 1;
		while (draft[pipeEnd] === "|") pipeEnd++;
		if (pipeEnd > offset + 1 && draft[pipeEnd] === "!") {
			output.push(`@${draft.slice(offset + 2, pipeEnd)}!`);
			offset = pipeEnd + 1;
			continue;
		}
		if (!draft.startsWith("@!", offset)) {
			output.push("@");
			offset++;
			continue;
		}
		if (draft.startsWith("@!@", offset)) {
			offset += 3;
			continue;
		}
		let end = offset + 2;
		while (
			end < draft.length &&
			draft[end] !== "@" &&
			draft[end] !== "\r" &&
			draft[end] !== "\n"
		)
			end++;
		const reference =
			draft[end] === "@"
				? parseReference(draft.slice(offset + 2, end))
				: undefined;
		let nextPrefix = end + 1;
		while (draft[nextPrefix] === "|") nextPrefix++;
		const closed =
			draft[end] === "@" &&
			(reference !== undefined || draft[nextPrefix] !== "!");
		const resolved = reference ? resolveReference(state, reference) : undefined;
		output.push(resolved ?? "(unresolved compaction reference)");
		offset = closed ? end + 1 : end;
	}
	return output.join("");
}
