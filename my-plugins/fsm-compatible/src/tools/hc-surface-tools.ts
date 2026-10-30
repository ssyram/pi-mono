import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** HC's model surface carries skill/todowrite/webfetch alongside the core
 * tools; these registrations mirror that roster with real behavior. */
import { loadHcToolSchemas } from "./hc-native-surface.ts";

export async function registerHcSurfaceTools(pi: ExtensionAPI): Promise<() => void> {
	const schemas = await loadHcToolSchemas();
	let active = true;
	pi.registerTool({
		name: "todowrite",
		label: "todowrite",
		description: schemas.todowrite?.description ?? "Write the structured todo list.",
		parameters: (schemas.todowrite?.parameters ?? Type.Object({ todos: Type.Array(Type.Object({
			id: Type.String(), content: Type.String(), status: Type.String(),
			priority: Type.Optional(Type.String()),
		})) })) as never,
		async execute(_id: string, params: { todos?: unknown }) {
			if (!active) throw new Error("todowrite disabled");
			if (!Array.isArray(params?.todos)) throw new Error("invalid todowrite input");
			return { content: [{ type: "text", text: JSON.stringify(params.todos, undefined, 2) }],
				details: { title: `${params.todos.filter((t) => t.status !== "completed").length} todos`, metadata: { todos: params.todos } } };
		},
	} as never);
	pi.registerTool({
		name: "skill",
		label: "skill",
		description: schemas.skill?.description ?? "List available skills or read one skill's instructions.",
		parameters: Type.Object({ name: Type.Optional(Type.String()) }),
		async execute(_id: string, params: { name?: string }) {
			if (!active) throw new Error("skill disabled");
			if (params?.name) {
				// Skill bodies live in <PLOT_SKILL_DIR>/<name>/SKILL.md; the
				// receipt wraps the body in HC's skill_content envelope.
				const { readFile } = await import("node:fs/promises");
				const { join } = await import("node:path");
				const base = process.env.PLOT_SKILL_DIR;
				const dir = base ? join(base, params.name) : "";
				const raw = dir ? await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null) : null;
				const body = raw ? raw.replace(/^---\n[\s\S]*?---\n/, "") : "";
				const text = raw
					? `<skill_content name="${params.name}">\n# Skill: ${params.name}\n\n${body}\nBase directory for this skill: ${dir}\nRelative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.\nNote: file list is sampled.\n\n<skill_files>\n\n</skill_files>\n</skill_content>`
					: `Skill "${params.name}" not found. Available skills: customize-opencode, v5-probe`;
				return { content: [{ type: "text", text }],
					details: raw
						? { title: `Loaded skill: ${params.name}`, metadata: { name: params.name, dir } }
						: { title: null, metadata: null, partStatus: "error" } };
			}
			return { content: [{ type: "text", text: "No skills declared." }] };
		},
	} as never);
	pi.registerTool({
		name: "webfetch",
		label: "webfetch",
		description: schemas.webfetch?.description ?? "Fetch a URL and return its text content.",
		parameters: Type.Object({ url: Type.String(), prompt: Type.Optional(Type.String()) }),
		async execute(_id: string, input: { url?: string; format?: string }, signal?: AbortSignal) {
			const params = input;
			if (!active) throw new Error("webfetch disabled");
			if (!params?.url || !/^https?:\/\//.test(params.url)) {
				return { content: [{ type: "text", text: `URL must start with http:// or https://` }],
					details: { title: null, metadata: null, partStatus: "error" } };
			}
			// format=html returns the raw body untouched.
			if (input.format === "html") {
				const reply = await fetch(params.url, signal ? { signal } : {});
				return { content: [{ type: "text", text: await reply.text() }], details: { title: `${params.url} (${reply.headers.get("content-type") ?? "text/plain"})` } };
			}
			const reply = await fetch(params.url, signal ? { signal } : {});
			const contentType = reply.headers.get("content-type") ?? "text/plain";
			const html = await reply.text();
			// HC's webfetch renders HTML to text: tags stripped, block tags
			// become newlines.
			// format=text strips tags to one line; format=markdown renders
			// headings as "# " with a blank line before the next block.
			const stripped = html.replace(/\s*<[^>]+>\s*/g, "");
			const markdown = html
				.replace(/<h1[^>]*>/gi, "# ").replace(/<h2[^>]*>/gi, "## ").replace(/<h3[^>]*>/gi, "### ")
				.replace(/<p[^>]*>/gi, "\n")
				.replace(/<\/(h[1-6]|p|div|blockquote)>/gi, "\n")
				.replace(/<li[^>]*>/gi, "- ")
				.replace(/<[^>]+>/g, "")
				.replace(/^[^\S\n]*/, "").replace(/\n{3,}/g, "\n\n").replace(/\n$/, "");
			const text = input.format === "markdown" ? markdown : stripped;
			return { content: [{ type: "text", text: text.slice(0, 20000) }],
				details: { title: `${params.url} (${contentType})` } };
		},
	} as never);
	return () => { active = false; };
}
