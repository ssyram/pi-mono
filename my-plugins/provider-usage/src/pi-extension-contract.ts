import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { FooterFactory } from "./footer-component.js";
import type { ControllerContext } from "./controller-contract.js";
import type { ContextUsageSnapshot, UsageModel } from "./usage-contract.js";

export interface PiExtensionContext {
	mode: "tui" | "rpc" | "json" | "print";
	model: UsageModel | undefined;
	thinkingLevel?: string;
	sessionManager: ControllerContext["sessionManager"];
	modelRegistry: ControllerContext["modelRegistry"];
	ui: {
		setFooter(factory: FooterFactory | undefined): void;
		notify(message: string, type?: "info" | "warning" | "error"): void;
		addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider): void;
	};
	getContextUsage(): ContextUsageSnapshot | undefined;
}

export type PiEventName = "session_start" | "model_select" | "thinking_level_select" | "turn_end" | "session_shutdown";

export interface PiEvent {
	model?: UsageModel;
	level?: string;
}

export type PiEventHandler = (event: PiEvent, context: PiExtensionContext) => void;

export interface PiExtensionAPI {
	on(event: PiEventName, handler: PiEventHandler): void;
	registerCommand(name: string, options: {
		description?: string;
		getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
		handler: (args: string, context: PiExtensionContext) => Promise<void>;
	}): void;
}
