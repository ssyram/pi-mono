import type { ImageContent, TextContent } from "@mariozechner/pi-ai";

export function serializeContent(content: (TextContent | ImageContent)[]): string {
	const lines: string[] = [];
	for (const block of content) {
		if (block.type === "text") {
			lines.push(block.text);
			continue;
		}
		lines.push(`[image: ${block.mimeType}]`);
	}
	return lines.join("\n").trim();
}
