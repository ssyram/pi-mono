declare module "turndown" {
	interface Options {
		headingStyle?: "setext" | "atx";
		hr?: string;
		bulletListMarker?: "-" | "+" | "*";
		codeBlockStyle?: "indented" | "fenced";
		emDelimiter?: "_" | "*";
		strongDelimiter?: "__" | "**";
		linkStyle?: "inlined" | "referenced";
		linkReferenceStyle?: "full" | "collapsed" | "shortcut";
	}

	class TurndownService {
		constructor(options?: Options);
		turndown(html: string): string;
		remove(filter: string | string[]): TurndownService;
		use(plugin: (service: TurndownService) => void): TurndownService;
		addRule(key: string, rule: unknown): TurndownService;
	}

	export default TurndownService;
}

declare module "turndown-plugin-gfm" {
	import type TurndownService from "turndown";
	export function gfm(service: TurndownService): void;
}
