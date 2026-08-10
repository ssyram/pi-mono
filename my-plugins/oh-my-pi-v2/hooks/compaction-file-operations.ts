interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export function extractCompactionFileOperations(
	messages: { role: string; content?: unknown }[],
): FileOperations {
	const operations: FileOperations = {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};

	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (
				typeof block !== "object" ||
				block === null ||
				!("type" in block) ||
				block.type !== "toolCall" ||
				!("arguments" in block) ||
				!("name" in block)
			) {
				continue;
			}

			const args = block.arguments as Record<string, unknown> | undefined;
			const path = typeof args?.path === "string" ? args.path : undefined;
			if (!path) continue;

			switch (block.name) {
				case "read":
					operations.read.add(path);
					break;
				case "write":
					operations.written.add(path);
					break;
				case "edit":
					operations.edited.add(path);
					break;
			}
		}
	}

	return operations;
}

export function formatCompactionFileOperations(operations: FileOperations): string {
	const modified = new Set([...operations.edited, ...operations.written]);
	const readOnly = [...operations.read].filter((file) => !modified.has(file)).sort();
	const modifiedFiles = [...modified].sort();
	const sections: string[] = [];

	if (readOnly.length > 0) sections.push(`<read-files>\n${readOnly.join("\n")}\n</read-files>`);
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}
	return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}
