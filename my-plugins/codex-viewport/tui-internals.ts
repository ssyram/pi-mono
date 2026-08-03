interface TuiInternals {
	doRender(): void;
}

function tuiInternals(value: unknown): TuiInternals {
	return value as TuiInternals;
}

export { tuiInternals };
export type { TuiInternals };
