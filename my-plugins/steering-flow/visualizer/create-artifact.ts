import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile as fsReadFile } from "node:fs/promises";
import { getSessionDir } from "../storage.js";
import { buildFileVisualizerDocument, buildSessionVisualizerDocument } from "./document.js";
import { renderVisualizerHtml } from "./render-html.js";
import type { VisualizerArtifactOptions, VisualizerArtifactResult } from "./types.js";

const DEFAULT_ARTIFACT_NAME = "steering-flow-visualizer.html";

function resolveOutputPath(cwd: string, outputFile?: string): string {
	if (!outputFile || outputFile.trim().length === 0) {
		return resolve(cwd, ".pi", DEFAULT_ARTIFACT_NAME);
	}
	const resolved = resolve(cwd, outputFile);
	const normalizedCwd = resolve(cwd);
	if (resolved === normalizedCwd || !resolved.startsWith(normalizedCwd + sep)) {
		throw new Error(`Output path must be within cwd: ${resolved}`);
	}
	return resolved;
}

export async function createVisualizerArtifact(options: VisualizerArtifactOptions): Promise<VisualizerArtifactResult> {
	const outputPath = resolveOutputPath(options.cwd, options.outputFile);
	let mode: "session" | "file" = "session";
	let sourceLabel: string;
	let fsmCount: number;
	let html: string;
	let warnings: string[] = [];

	if (options.flowFile) {
		const absFlow = resolve(options.cwd, options.flowFile);
		const normalizedFlowCwd = resolve(options.cwd);
		if (absFlow === normalizedFlowCwd || !absFlow.startsWith(normalizedFlowCwd + sep)) {
			throw new Error(`Flow file path must be within cwd: ${absFlow}`);
		}
		const content = await fsReadFile(absFlow, "utf8");
		const { document, warnings: w } = buildFileVisualizerDocument(content, absFlow);
		warnings = w;
		html = renderVisualizerHtml(document);
		mode = "file";
		sourceLabel = absFlow;
		fsmCount = document.fsms.length;
	} else {
		const sessionDir = getSessionDir(options.cwd, options.sessionId);
		const { document, warnings: w } = await buildSessionVisualizerDocument(sessionDir, options.sessionId);
		warnings = w;
		html = renderVisualizerHtml(document);
		sourceLabel = document.sourceLabel;
		fsmCount = document.fsms.length;
	}

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, html, "utf8");
	return { mode, outputPath, sourceLabel, fsmCount, warnings };
}

export function visualizerModuleDir(): string {
	return dirname(fileURLToPath(import.meta.url));
}
