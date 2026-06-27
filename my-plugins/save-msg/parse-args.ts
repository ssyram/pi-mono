export interface Options {
	pick: boolean;
	withTools: boolean;
	raw: boolean;
	append: boolean;
	noHeader: boolean;
	help: boolean;
	path: string | undefined;
}

export type ParseResult =
	| { ok: true; options: Options }
	| { ok: false; error: string };

export function parseArgs(raw: string): ParseResult {
	const tokens = raw.trim().split(/\s+/).filter(t => t.length > 0);
	const opts: Options = {
		pick: false, withTools: false, raw: false,
		append: false, noHeader: false, help: false, path: undefined,
	};
	for (const t of tokens) {
		if (t === "--pick") opts.pick = true;
		else if (t === "--with-tools") opts.withTools = true;
		else if (t === "--raw") opts.raw = true;
		else if (t === "--append") opts.append = true;
		else if (t === "--no-header") opts.noHeader = true;
		else if (t === "--help" || t === "-h") opts.help = true;
		else if (t.startsWith("-")) {
			return { ok: false, error: `Unknown option: ${t}` };
		} else if (opts.path !== undefined) {
			return { ok: false, error: `Multiple paths given: ${opts.path} and ${t}` };
		} else {
			opts.path = t;
		}
	}
	return { ok: true, options: opts };
}
